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
from .pdf import _get_path  # Import the file path resolver from pdf router

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
    Parse BQ data from extracted text using column-based extraction.
    
    BQ Table Structure (horizontal integration):
    - Each physical row in the PDF = one output row
    - Columns: Ref (Item), Description, Qty, Unit, Rate, Total
    - If row has Item ref AND Qty/Unit → "item"
    - Otherwise → "notes"
    
    The key is HORIZONTAL integration: all columns on the same Y coordinate
    should be merged into a single output row.
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
            
            # Get DataRange bounding box
            dr_bbox = (
                data_range_box.x * page_width,
                data_range_box.y * page_height,
                (data_range_box.x + data_range_box.width) * page_width,
                (data_range_box.y + data_range_box.height) * page_height
            )
            
            # Calculate column bounding boxes (absolute X coordinates)
            col_bboxes = {}
            for col_name, box in column_boxes.items():
                col_x0 = box.x * page_width
                col_x1 = (box.x + box.width) * page_width
                col_bboxes[col_name] = (col_x0, col_x1)
            
            # Extract words from DataRange
            cropped = page.within_bbox(dr_bbox)
            words = cropped.extract_words(keep_blank_chars=True, y_tolerance=3, x_tolerance=3)
            
            if not words:
                return rows
            
            # Step 1: Group words by Y coordinate into physical rows
            # Use smaller tolerance to avoid merging different lines
            y_tolerance = 4
            physical_rows: list[tuple[float, list]] = []
            
            for w in words:
                y_mid = (w['top'] + w['bottom']) / 2
                found = False
                for i, (row_y, row_words) in enumerate(physical_rows):
                    if abs(row_y - y_mid) <= y_tolerance:
                        row_words.append(w)
                        # Update row_y to average
                        physical_rows[i] = ((row_y * len(row_words) + y_mid) / (len(row_words) + 1), row_words)
                        found = True
                        break
                if not found:
                    physical_rows.append((y_mid, [w]))
            
            # Sort by Y position (top to bottom)
            physical_rows.sort(key=lambda x: x[0])
            
            # Step 2: For each physical row, assign words to columns (HORIZONTAL integration)
            def parse_number(s: str) -> float | None:
                """Parse a number string, handling commas"""
                s = s.replace(",", "").strip()
                if not s:
                    return None
                try:
                    return float(s)
                except ValueError:
                    return None
            
            for y_pos, row_words in physical_rows:
                # Sort words by X position (left to right)
                row_words.sort(key=lambda w: w['x0'])
                
                # Assign each word to a column based on X position
                col_texts = {col: [] for col in col_bboxes}
                unassigned = []
                
                for w in row_words:
                    word_x0 = w['x0']
                    word_x1 = w['x1']
                    word_x_mid = (word_x0 + word_x1) / 2
                    text = w['text'].strip()
                    if not text:
                        continue
                    
                    assigned = False
                    for col_name, (cx0, cx1) in col_bboxes.items():
                        # Check if word overlaps with column
                        if cx0 <= word_x_mid <= cx1:
                            col_texts[col_name].append(text)
                            assigned = True
                            break
                    
                    if not assigned:
                        unassigned.append(text)
                
                # Build column values
                item_no = " ".join(col_texts.get("Item", []))
                description = " ".join(col_texts.get("Description", []))
                qty_str = " ".join(col_texts.get("Qty", []))
                unit = " ".join(col_texts.get("Unit", []))
                rate_str = " ".join(col_texts.get("Rate", []))
                total_str = " ".join(col_texts.get("Total", []))
                
                # If Description is empty but we have unassigned text, use it
                if not description and unassigned:
                    description = " ".join(unassigned)
                
                # Parse numeric values
                quantity = parse_number(qty_str)
                rate = parse_number(rate_str)
                total = parse_number(total_str)
                
                # Skip completely empty rows
                if not item_no and not description and quantity is None and not unit:
                    continue
                
                # Classification:
                # - "item" if has Item ref AND (Qty OR Unit has value)
                # - "notes" otherwise
                has_item_ref = bool(item_no.strip())
                has_qty_unit = quantity is not None or bool(unit.strip())
                row_type = "item" if (has_item_ref and has_qty_unit) else "notes"
                
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
                type="notes",
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
    
    # Get PDF path from the in-memory store (shared with pdf router)
    pdf_path = _get_path(request.file_id)
    
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
