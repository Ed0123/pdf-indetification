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
    Parse BQ data using text block analysis.
    
    Logic:
    1. Use Column Headers X ranges to slice DataRange text into columns
    2. For Description column: analyze Y distances between lines
       - Close lines (within threshold) = same text block (merge)
       - Far lines = separate text blocks (notes)
    3. For Item, Qty, Unit, Rate, Total: find Y coordinate of each value
    4. Match them to the nearest Description text block by Y coordinate
    
    This approach handles multi-line descriptions correctly.
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
            
            # Get DataRange bounding box (absolute coordinates)
            dr_bbox = (
                data_range_box.x * page_width,
                data_range_box.y * page_height,
                (data_range_box.x + data_range_box.width) * page_width,
                (data_range_box.y + data_range_box.height) * page_height
            )
            
            # Calculate column X ranges (absolute coordinates)
            col_x_ranges = {}
            for col_name, box in column_boxes.items():
                col_x_ranges[col_name] = (
                    box.x * page_width,
                    (box.x + box.width) * page_width
                )
            
            # Extract words from DataRange
            cropped = page.within_bbox(dr_bbox)
            words = cropped.extract_words(keep_blank_chars=True, y_tolerance=3, x_tolerance=3)
            
            if not words:
                return rows
            
            # Step 1: Assign each word to a column based on X position
            col_words: dict[str, list] = {col: [] for col in col_x_ranges}
            col_words["_unassigned"] = []
            
            for w in words:
                word_x_mid = (w['x0'] + w['x1']) / 2
                word_y_mid = (w['top'] + w['bottom']) / 2
                text = w['text'].strip()
                if not text:
                    continue
                
                assigned = False
                for col_name, (cx0, cx1) in col_x_ranges.items():
                    if cx0 <= word_x_mid <= cx1:
                        col_words[col_name].append({
                            'text': text,
                            'y': word_y_mid,
                            'y_top': w['top'],
                            'y_bottom': w['bottom'],
                            'x0': w['x0'],
                            'x1': w['x1']
                        })
                        assigned = True
                        break
                
                if not assigned:
                    col_words["_unassigned"].append({
                        'text': text,
                        'y': word_y_mid,
                        'y_top': w['top'],
                        'y_bottom': w['bottom']
                    })
            
            # If Description column is empty, use unassigned words
            if not col_words.get("Description") and col_words.get("_unassigned"):
                col_words["Description"] = col_words["_unassigned"]
            
            # Step 2: Analyze Description column - group by Y distance into text blocks
            desc_words = sorted(col_words.get("Description", []), key=lambda w: w['y'])
            
            # Calculate line spacing threshold
            # Analyze distances between consecutive words
            if len(desc_words) >= 2:
                y_distances = []
                for i in range(1, len(desc_words)):
                    dist = desc_words[i]['y'] - desc_words[i-1]['y']
                    if dist > 0:  # Only positive distances (next line is below)
                        y_distances.append(dist)
                
                if y_distances:
                    # Use median distance as typical line spacing
                    sorted_dists = sorted(y_distances)
                    median_dist = sorted_dists[len(sorted_dists) // 2]
                    # Threshold: 1.8x median is considered same block
                    block_threshold = median_dist * 1.8
                else:
                    block_threshold = 15  # Default
            else:
                block_threshold = 15
            
            # Group Description words into text blocks
            desc_blocks: list[dict] = []  # [{texts: [], y_start, y_end}]
            
            for word in desc_words:
                if not desc_blocks:
                    desc_blocks.append({
                        'texts': [word['text']],
                        'y_start': word['y_top'],
                        'y_end': word['y_bottom'],
                        'y_center': word['y']
                    })
                else:
                    last_block = desc_blocks[-1]
                    dist = word['y_top'] - last_block['y_end']
                    
                    if dist <= block_threshold:
                        # Same block - merge
                        last_block['texts'].append(word['text'])
                        last_block['y_end'] = word['y_bottom']
                        # Update center as average
                        last_block['y_center'] = (last_block['y_start'] + word['y_bottom']) / 2
                    else:
                        # New block
                        desc_blocks.append({
                            'texts': [word['text']],
                            'y_start': word['y_top'],
                            'y_end': word['y_bottom'],
                            'y_center': word['y']
                        })
            
            # Finalize block descriptions
            for block in desc_blocks:
                block['description'] = ' '.join(block['texts'])
            
            # Step 3: Extract Item, Qty, Unit, Rate, Total values with Y positions
            def extract_col_values(col_name: str) -> list[dict]:
                """Extract values from a column with their Y positions"""
                words = sorted(col_words.get(col_name, []), key=lambda w: w['y'])
                # Group words on same Y into single values
                values = []
                y_tolerance = 5
                
                for word in words:
                    if not values:
                        values.append({'text': word['text'], 'y': word['y']})
                    else:
                        last = values[-1]
                        if abs(word['y'] - last['y']) <= y_tolerance:
                            # Same line, append
                            last['text'] += ' ' + word['text']
                        else:
                            values.append({'text': word['text'], 'y': word['y']})
                
                return values
            
            item_values = extract_col_values("Item")
            qty_values = extract_col_values("Qty")
            unit_values = extract_col_values("Unit")
            rate_values = extract_col_values("Rate")
            total_values = extract_col_values("Total")
            
            # Step 4: Match Item/Qty/Unit/Rate/Total to nearest Description block
            def find_nearest_block(y: float, blocks: list[dict]) -> int:
                """Find index of block with Y range closest to y"""
                if not blocks:
                    return -1
                
                best_idx = 0
                best_dist = float('inf')
                
                for i, block in enumerate(blocks):
                    # Check if y is within block range
                    if block['y_start'] <= y <= block['y_end']:
                        return i
                    # Or find closest
                    dist = min(abs(y - block['y_start']), abs(y - block['y_end']))
                    if dist < best_dist:
                        best_dist = dist
                        best_idx = i
                
                return best_idx
            
            def parse_number(s: str) -> float | None:
                """Parse number, handling commas"""
                s = s.replace(",", "").strip()
                try:
                    return float(s)
                except ValueError:
                    return None
            
            # Create output rows
            # First, match items to blocks
            block_data: list[dict] = [{'block': b, 'item': '', 'qty': None, 'unit': '', 'rate': None, 'total': None} 
                                       for b in desc_blocks]
            
            # Match Item values
            for val in item_values:
                idx = find_nearest_block(val['y'], desc_blocks)
                if idx >= 0:
                    block_data[idx]['item'] = val['text']
            
            # Match Qty values
            for val in qty_values:
                idx = find_nearest_block(val['y'], desc_blocks)
                if idx >= 0:
                    block_data[idx]['qty'] = parse_number(val['text'])
            
            # Match Unit values
            for val in unit_values:
                idx = find_nearest_block(val['y'], desc_blocks)
                if idx >= 0:
                    block_data[idx]['unit'] = val['text']
            
            # Match Rate values
            for val in rate_values:
                idx = find_nearest_block(val['y'], desc_blocks)
                if idx >= 0:
                    block_data[idx]['rate'] = parse_number(val['text'])
            
            # Match Total values
            for val in total_values:
                idx = find_nearest_block(val['y'], desc_blocks)
                if idx >= 0:
                    block_data[idx]['total'] = parse_number(val['text'])
            
            # Step 5: Create output rows
            for bd in block_data:
                block = bd['block']
                item_no = bd['item']
                quantity = bd['qty']
                unit = bd['unit']
                rate = bd['rate']
                total = bd['total']
                description = block['description']
                
                # Skip empty
                if not description and not item_no:
                    continue
                
                # Classification: item if has Item ref AND (Qty OR Unit)
                has_item = bool(item_no.strip())
                has_qty_unit = quantity is not None or bool(unit.strip())
                row_type = "item" if (has_item and has_qty_unit) else "notes"
                
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
