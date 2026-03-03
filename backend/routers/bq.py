"""
BQ (Bill of Quantities) extraction router.

Provides endpoints for:
- Listing available BQ OCR engines
- Extracting BQ data from PDF pages
- Managing BQ templates
"""

import os
import re
from typing import Optional, Literal
from fastapi import APIRouter, HTTPException, Depends, Request
from pydantic import BaseModel

from ..auth_middleware import require_auth
from ..firebase_setup import get_db

# ─── Configuration ─────────────────────────────────────────────────────────────

_DEV_MODE = os.getenv("DEV_MODE", "") == "1"
USERS_COLLECTION = "users"
TIERS_COLLECTION = "tiers"

router = APIRouter(prefix="/api/bq", tags=["bq"])


# ─── Request/Response Models ───────────────────────────────────────────────────

class BQEngineInfo(BaseModel):
    """Information about a BQ OCR engine."""
    id: str
    name: str
    quota_cost: int
    available: bool
    description: str = ""


class BoxDefinition(BaseModel):
    """A single box definition for extraction."""
    column_name: str
    x: float
    y: float
    width: float
    height: float


class BQExtractRequest(BaseModel):
    """Request body for BQ extraction."""
    file_id: str
    pages: list[int]  # 0-based page indices
    boxes: list[BoxDefinition]
    engine: Literal["pdfplumber", "camelot-lattice", "camelot-stream"] = "pdfplumber"


class BQRowResponse(BaseModel):
    """A single BQ row in the response."""
    id: int
    file_id: str
    page_number: int
    page_label: str = ""
    revision: str = ""
    bill_name: str = ""
    collection: str = ""
    type: str = "item"  # heading1, heading2, item
    item_no: str = ""
    description: str = ""
    quantity: Optional[float] = None
    unit: str = ""
    rate: Optional[float] = None
    total: Optional[float] = None


class BQExtractResponse(BaseModel):
    """Response body for BQ extraction."""
    success: bool
    rows: list[BQRowResponse] = []
    warnings: list[str] = []
    engine: str = "pdfplumber"
    pages_processed: int = 0
    quota_cost: int = 0


# ─── Helper Functions ──────────────────────────────────────────────────────────

def _check_bq_permission(user: dict) -> dict:
    """
    Check if user has permission to use BQ features.
    Reads from Firestore to get actual tier configuration.
    Returns user profile dict if permitted, raises 403 otherwise.
    """
    if _DEV_MODE:
        return {"uid": "dev", "tier": "admin"}
    
    db = get_db()
    uid = user.get("uid", "")
    
    # Get user profile from Firestore
    user_doc = db.collection(USERS_COLLECTION).document(uid).get()
    if not user_doc.exists:
        raise HTTPException(status_code=403, detail="User profile not found")
    
    user_profile = user_doc.to_dict()
    user_tier = user_profile.get("tier", "basic")
    
    # Get tier configuration to check bq_ocr feature
    tier_doc = db.collection(TIERS_COLLECTION).document(user_tier).get()
    if tier_doc.exists:
        tier_config = tier_doc.to_dict()
        features = tier_config.get("features", {})
        if features.get("bq_ocr", False):
            return user_profile
    
    # Fallback: allow sponsor tier and above
    allowed_tiers = ["sponsor", "premium", "admin"]
    if user_tier in allowed_tiers:
        return user_profile
    
    raise HTTPException(
        status_code=403,
        detail=f"BQ feature requires sponsor tier or above (current: {user_tier})"
    )


def _get_uploaded_pdf_path(file_id: str) -> str:
    """Get path to uploaded PDF file."""
    import tempfile
    upload_dir = os.path.join(tempfile.gettempdir(), "pdf_uploads")
    path = os.path.join(upload_dir, f"{file_id}.pdf")
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail=f"File not found: {file_id}")
    return path


def _extract_text_from_box(pdf_path: str, page_num: int, box: BoxDefinition, engine: str = "pdfplumber") -> str:
    """Extract text from a specific box region on a PDF page."""
    import fitz  # PyMuPDF
    
    doc = fitz.open(pdf_path)
    if page_num < 0 or page_num >= len(doc):
        doc.close()
        return ""
    
    page = doc[page_num]
    rect = page.rect
    
    # Convert relative coords (0-1) to absolute
    x0 = rect.x0 + box.x * rect.width
    y0 = rect.y0 + box.y * rect.height
    x1 = x0 + box.width * rect.width
    y1 = y0 + box.height * rect.height
    
    clip_rect = fitz.Rect(x0, y0, x1, y1)
    text = page.get_text("text", clip=clip_rect).strip()
    
    doc.close()
    return text


def _parse_bq_rows(
    file_id: str,
    page_num: int,
    boxes: list[BoxDefinition],
    engine: str,
    pdf_path: str
) -> list[BQRowResponse]:
    """
    Parse BQ data from extracted text.
    
    Extracts zone info (PageNo, Revision, BillName, Collection) and
    parses the DataRange area into structured rows.
    """
    import fitz
    
    # Extract zone information
    zone_data = {}
    for box in boxes:
        if box.column_name in ["PageNo", "Revision", "BillName", "Collection"]:
            text = _extract_text_from_box(pdf_path, page_num, box, engine)
            zone_data[box.column_name] = text.strip()
    
    page_label = zone_data.get("PageNo", "")
    revision = zone_data.get("Revision", "")
    bill_name = zone_data.get("BillName", "")
    collection = zone_data.get("Collection", "")
    
    # Find DataRange box
    data_range_box = next((b for b in boxes if b.column_name == "DataRange"), None)
    if not data_range_box:
        return []
    
    # Find column boxes
    column_boxes = {b.column_name: b for b in boxes if b.column_name in [
        "Item", "Description", "Qty", "Unit", "Rate", "Total"
    ]}
    
    # Use pdfplumber for table extraction if available
    rows: list[BQRowResponse] = []
    row_id = 1
    
    try:
        import pdfplumber
        
        with pdfplumber.open(pdf_path) as pdf:
            if page_num >= len(pdf.pages):
                return []
            
            page = pdf.pages[page_num]
            page_width = page.width
            page_height = page.height
            
            # Convert DataRange to absolute coords
            bbox = (
                data_range_box.x * page_width,
                data_range_box.y * page_height,
                (data_range_box.x + data_range_box.width) * page_width,
                (data_range_box.y + data_range_box.height) * page_height
            )
            
            # Crop to DataRange and extract tables
            cropped = page.within_bbox(bbox)
            tables = cropped.extract_tables()
            
            for table in tables:
                for row_data in table:
                    if not row_data or all(not cell for cell in row_data):
                        continue
                    
                    # Try to identify row type and extract data
                    row_text = " ".join(str(cell or "") for cell in row_data).strip()
                    
                    # Skip empty rows
                    if not row_text:
                        continue
                    
                    # Determine row type
                    row_type = "item"
                    item_no = ""
                    description = row_text
                    quantity = None
                    unit = ""
                    rate = None
                    total = None
                    
                    # Check if this is a heading (no quantity, no item number)
                    has_number_start = bool(re.match(r'^\d+\s', row_text))
                    
                    if len(row_data) >= 4:
                        # Assume format: [Item, Description, Qty, Unit, ...Rate, Total]
                        item_no = str(row_data[0] or "").strip()
                        description = str(row_data[1] or "").strip() if len(row_data) > 1 else ""
                        
                        if len(row_data) > 2:
                            try:
                                qty_str = str(row_data[2] or "").strip().replace(",", "")
                                if qty_str:
                                    quantity = float(qty_str)
                            except (ValueError, TypeError):
                                pass
                        
                        if len(row_data) > 3:
                            unit = str(row_data[3] or "").strip()
                        
                        if len(row_data) > 4:
                            try:
                                rate_str = str(row_data[4] or "").strip().replace(",", "")
                                if rate_str:
                                    rate = float(rate_str)
                            except (ValueError, TypeError):
                                pass
                        
                        if len(row_data) > 5:
                            try:
                                total_str = str(row_data[5] or "").strip().replace(",", "")
                                if total_str:
                                    total = float(total_str)
                            except (ValueError, TypeError):
                                pass
                        
                        # Classify row type
                        if not item_no and description and quantity is None:
                            if description.isupper() or "(Cont'd)" in description:
                                row_type = "heading1"
                            elif description.startswith("Design,") or description.startswith("Fire rated"):
                                row_type = "heading2"
                            else:
                                row_type = "heading2"
                        elif item_no:
                            row_type = "item"
                    
                    rows.append(BQRowResponse(
                        id=row_id,
                        file_id=file_id,
                        page_number=page_num,
                        page_label=page_label,
                        revision=revision,
                        bill_name=bill_name,
                        collection=collection,
                        type=row_type,
                        item_no=item_no,
                        description=description,
                        quantity=quantity,
                        unit=unit,
                        rate=rate,
                        total=total
                    ))
                    row_id += 1
    
    except ImportError:
        # Fallback to PyMuPDF text extraction
        text = _extract_text_from_box(pdf_path, page_num, data_range_box, engine)
        lines = text.split("\n")
        
        for line in lines:
            line = line.strip()
            if not line:
                continue
            
            rows.append(BQRowResponse(
                id=row_id,
                file_id=file_id,
                page_number=page_num,
                page_label=page_label,
                revision=revision,
                bill_name=bill_name,
                collection=collection,
                type="item",
                item_no="",
                description=line,
                quantity=None,
                unit="",
                rate=None,
                total=None
            ))
            row_id += 1
    
    return rows


# ─── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/engines", response_model=list[BQEngineInfo])
async def list_bq_engines():
    """List available BQ OCR engines."""
    engines = [
        BQEngineInfo(
            id="pdfplumber",
            name="PDFPlumber",
            quota_cost=1,
            available=True,
            description="Best for clean, digital PDFs with clear table structure"
        ),
        BQEngineInfo(
            id="camelot-lattice",
            name="Camelot (Lattice)",
            quota_cost=3,
            available=False,  # Requires cv2
            description="Detects tables using cell borders (requires clean lines)"
        ),
        BQEngineInfo(
            id="camelot-stream",
            name="Camelot (Stream)",
            quota_cost=3,
            available=False,  # Requires cv2
            description="Detects tables using whitespace (for borderless tables)"
        ),
    ]
    return engines


@router.post("/extract", response_model=BQExtractResponse)
async def extract_bq(
    request: BQExtractRequest,
    user: dict = Depends(require_auth)
):
    """
    Extract BQ data from PDF pages.
    
    Requires boxes to be defined for column headers and zones.
    Zone boxes: DataRange (required), PageNo, Revision, BillName, Collection
    Column boxes: Item, Description, Qty, Unit, Rate, Total
    """
    # Check permission
    user_profile = _check_bq_permission(user)
    
    # Get PDF path
    pdf_path = _get_uploaded_pdf_path(request.file_id)
    
    # Process each page
    all_rows: list[BQRowResponse] = []
    warnings: list[str] = []
    pages_processed = 0
    
    for page_num in request.pages:
        try:
            rows = _parse_bq_rows(
                file_id=request.file_id,
                page_num=page_num,
                boxes=request.boxes,
                engine=request.engine,
                pdf_path=pdf_path
            )
            
            # Renumber IDs to be globally unique
            start_id = len(all_rows) + 1
            for i, row in enumerate(rows):
                row.id = start_id + i
            
            all_rows.extend(rows)
            pages_processed += 1
            
        except Exception as e:
            warnings.append(f"Page {page_num + 1}: {str(e)}")
    
    # Calculate quota cost
    quota_cost = pages_processed * 1  # 1 point per page for pdfplumber
    if request.engine.startswith("camelot"):
        quota_cost = pages_processed * 3
    
    return BQExtractResponse(
        success=True,
        rows=all_rows,
        warnings=warnings,
        engine=request.engine,
        pages_processed=pages_processed,
        quota_cost=quota_cost
    )
