"""
BQ (Bill of Quantities) extraction router.

Provides endpoints for:
- Listing available BQ OCR engines
- Extracting BQ data from PDF pages
- Managing BQ templates
"""

import os
import re
from datetime import datetime, timezone
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


# ─── Usage recording helpers ───────────────────────────────────────────────────

def _user_ref(uid: str):
    """Reference to a user document in Firestore."""
    return get_db().collection(USERS_COLLECTION).document(uid)


def _tiers_collection():
    """Reference to tiers collection."""
    return get_db().collection(TIERS_COLLECTION)


def _get_tier_quota(tier_name: str) -> int:
    """Return monthly page quota for a tier name. -1 = unlimited."""
    docs = list(_tiers_collection().stream())
    for d in docs:
        data = d.to_dict()
        if data.get("name") == tier_name:
            return data.get("quota", 100)
    return 100  # fallback


def _record_usage(uid: str, pages: int) -> dict:
    """Record BQ OCR usage for a user (shared with page OCR quota)."""
    ref = _user_ref(uid)
    snap = ref.get()
    if not snap.exists:
        raise HTTPException(404, "User profile not found")

    profile = snap.to_dict()
    current_month = datetime.now(timezone.utc).strftime("%Y-%m")

    # Reset counter if new month
    if profile.get("usage_month") != current_month:
        profile["usage_month"] = current_month
        profile["usage_pages"] = 0

    # Tier limits
    quota = _get_tier_quota(profile.get("tier", "basic"))
    limit = float("inf") if quota == -1 else quota
    current_usage = profile.get("usage_pages", 0)

    # Check if would exceed limit
    new_count = current_usage + pages
    if new_count > limit:
        return {
            "usage_pages": current_usage,
            "limit": quota,
            "over_limit": True,
        }

    # Record usage
    ref.update({
        "usage_month": current_month,
        "usage_pages": new_count,
    })

    return {
        "usage_pages": new_count,
        "limit": quota,
        "over_limit": False,
    }


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
    # Bounding box for UI highlighting (PDF coordinates)
    bbox_x0: Optional[float] = None
    bbox_y0: Optional[float] = None
    bbox_x1: Optional[float] = None
    bbox_y1: Optional[float] = None


class BQExtractResponse(BaseModel):
    """Response body for BQ extraction."""
    success: bool
    rows: list[BQRowResponse] = []
    warnings: list[str] = []
    engine: str = "pdfplumber"
    pages_processed: int = 0
    quota_cost: int = 0
    debug_info: dict = {}  # Debug information about parsing


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
) -> tuple[list[BQRowResponse], dict]:
    """
    Parse BQ data using text block analysis.
    Returns (rows, debug_info) tuple.
    
    Key insight: Column Header boxes define the X boundaries for columns.
    We use the LEFT EDGE of each column header box as the starting point,
    and extend to the LEFT EDGE of the next column (sorted by X).
    """
    import fitz
    import logging
    logger = logging.getLogger(__name__)
    
    parse_debug = {
        "page_size": None,
        "data_range_bbox": None,
        "column_x_ranges": {},
        "words_extracted": 0,
        "words_per_column": {},
        "desc_blocks_count": 0,
        "item_values": [],
        "qty_values": [],
    }
    
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
        logger.warning("No DataRange box found")
        parse_debug["error"] = "No DataRange box found"
        return [], parse_debug
    
    # Store DataRange box info for debugging
    parse_debug["data_range_box_relative"] = {
        "x": data_range_box.x, "y": data_range_box.y,
        "w": data_range_box.width, "h": data_range_box.height
    }
    
    # Find column boxes and sort by X position
    column_boxes = [(b.column_name, b) for b in boxes if b.column_name in [
        "Item", "Description", "Qty", "Unit", "Rate", "Total"
    ]]
    column_boxes.sort(key=lambda x: x[1].x)  # Sort by X position
    
    parse_debug["column_boxes_sorted"] = [c[0] for c in column_boxes]
    logger.info(f"Column boxes (sorted by X): {[c[0] for c in column_boxes]}")
    
    rows: list[BQRowResponse] = []
    row_id = 1
    
    # Check if file exists
    import os
    parse_debug["pdf_path"] = pdf_path
    parse_debug["pdf_exists"] = os.path.exists(pdf_path) if pdf_path else False
    
    if not pdf_path or not os.path.exists(pdf_path):
        parse_debug["error"] = f"PDF file not found: {pdf_path}"
        return [], parse_debug
    
    try:
        import pdfplumber
        
        with pdfplumber.open(pdf_path) as pdf:
            parse_debug["pdf_page_count"] = len(pdf.pages)
            parse_debug["requested_page"] = page_num
            
            if page_num >= len(pdf.pages):
                parse_debug["error"] = f"Page {page_num} out of range (PDF has {len(pdf.pages)} pages)"
                return rows, parse_debug
            
            page = pdf.pages[page_num]
            page_width = page.width
            page_height = page.height
            parse_debug["page_size"] = {"width": page_width, "height": page_height}
            
            # Get DataRange bounding box (absolute coordinates)
            dr_bbox = (
                data_range_box.x * page_width,
                data_range_box.y * page_height,
                (data_range_box.x + data_range_box.width) * page_width,
                (data_range_box.y + data_range_box.height) * page_height
            )
            dr_x0, dr_y0, dr_x1, dr_y1 = dr_bbox
            parse_debug["data_range_bbox"] = {"x0": dr_x0, "y0": dr_y0, "x1": dr_x1, "y1": dr_y1}
            
            # Build contiguous column X ranges from sorted columns
            # Each column spans from its X to the next column's X (or DataRange right edge)
            col_x_ranges: dict[str, tuple[float, float]] = {}
            
            for i, (col_name, box) in enumerate(column_boxes):
                col_left = box.x * page_width
                
                # Right edge: next column's left edge, or DataRange right edge
                if i < len(column_boxes) - 1:
                    next_box = column_boxes[i + 1][1]
                    col_right = next_box.x * page_width
                else:
                    col_right = dr_x1
                
                col_x_ranges[col_name] = (col_left, col_right)
                parse_debug["column_x_ranges"][col_name] = {"x0": col_left, "x1": col_right}
                logger.info(f"Column {col_name}: X range [{col_left:.1f}, {col_right:.1f}]")
            
            # If no column boxes defined, fallback: treat everything as Description
            if not col_x_ranges:
                col_x_ranges["Description"] = (dr_x0, dr_x1)
            
            # Extract words from DataRange
            cropped = page.within_bbox(dr_bbox)
            words = cropped.extract_words(keep_blank_chars=True, y_tolerance=3, x_tolerance=3)
            
            parse_debug["words_extracted"] = len(words)
            
            # Log first few words for debugging
            if words:
                sample_words = [{"text": w['text'], "x0": w['x0'], "x1": w['x1'], "top": w['top']} for w in words[:5]]
                parse_debug["sample_words"] = sample_words
            
            logger.info(f"Extracted {len(words)} words from DataRange")
            
            if not words:
                return rows, parse_debug
            
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
                    if cx0 <= word_x_mid < cx1:  # Note: < not <= for right boundary
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
                        'y_bottom': w['bottom'],
                        'x0': w['x0'],
                        'x1': w['x1']
                    })
            
            # Log word distribution
            for col, wds in col_words.items():
                parse_debug["words_per_column"][col] = len(wds)
                if wds:
                    logger.info(f"Column {col}: {len(wds)} words")
            
            # If Description column is empty, use unassigned words
            if not col_words.get("Description") and col_words.get("_unassigned"):
                col_words["Description"] = col_words["_unassigned"]
            
            # ============================================================
            # NEW APPROACH: Line-by-line analysis
            # ============================================================
            # Step 2a: Group Description words into LINES first
            desc_words = sorted(col_words.get("Description", []), key=lambda w: (w['y'], w['x0']))
            
            # Group words into lines (words with similar Y = same line)
            line_y_tolerance = 5
            desc_lines: list[dict] = []  # [{texts: [], y_top, y_bottom, y_center}]
            
            for word in desc_words:
                if not desc_lines:
                    desc_lines.append({
                        'texts': [word['text']],
                        'y_top': word['y_top'],
                        'y_bottom': word['y_bottom'],
                        'y_center': word['y'],
                        'x0': word['x0'],
                        'x1': word['x1']
                    })
                else:
                    last_line = desc_lines[-1]
                    # Same line if Y is very close
                    if abs(word['y'] - last_line['y_center']) <= line_y_tolerance:
                        last_line['texts'].append(word['text'])
                        last_line['x1'] = max(last_line['x1'], word['x1'])
                        last_line['y_bottom'] = max(last_line['y_bottom'], word['y_bottom'])
                    else:
                        # New line
                        desc_lines.append({
                            'texts': [word['text']],
                            'y_top': word['y_top'],
                            'y_bottom': word['y_bottom'],
                            'y_center': word['y'],
                            'x0': word['x0'],
                            'x1': word['x1']
                        })
            
            # Finalize line text
            for line in desc_lines:
                line['text'] = ' '.join(line['texts'])
            
            # Step 2b: Calculate line spacing threshold
            if len(desc_lines) >= 2:
                line_gaps = []
                for i in range(1, len(desc_lines)):
                    gap = desc_lines[i]['y_top'] - desc_lines[i-1]['y_bottom']
                    if gap > 0:
                        line_gaps.append(gap)
                
                if line_gaps:
                    sorted_gaps = sorted(line_gaps)
                    median_gap = sorted_gaps[len(sorted_gaps) // 2]
                    # Threshold: 2.5x median gap is considered a paragraph break
                    para_threshold = median_gap * 2.5
                else:
                    para_threshold = 20
            else:
                para_threshold = 20
            
            parse_debug["line_count"] = len(desc_lines)
            parse_debug["para_threshold"] = para_threshold
            
            # Step 2c: Extract Item values with Y positions (these mark new items)
            def extract_col_lines(col_name: str) -> list[dict]:
                """Extract values from a column, grouped by line"""
                words = sorted(col_words.get(col_name, []), key=lambda w: (w['y'], w['x0']))
                lines = []
                y_tolerance = 5
                
                for word in words:
                    if not lines:
                        lines.append({
                            'text': word['text'],
                            'y': word['y'],
                            'y_top': word['y_top'],
                            'y_bottom': word['y_bottom'],
                            'x0': word['x0'],
                            'x1': word['x1']
                        })
                    else:
                        last = lines[-1]
                        if abs(word['y'] - last['y']) <= y_tolerance:
                            last['text'] += ' ' + word['text']
                            last['x1'] = max(last['x1'], word['x1'])
                        else:
                            lines.append({
                                'text': word['text'],
                                'y': word['y'],
                                'y_top': word['y_top'],
                                'y_bottom': word['y_bottom'],
                                'x0': word['x0'],
                                'x1': word['x1']
                            })
                return lines
            
            item_lines = extract_col_lines("Item")
            qty_lines = extract_col_lines("Qty")
            unit_lines = extract_col_lines("Unit")
            rate_lines = extract_col_lines("Rate")
            total_lines = extract_col_lines("Total")
            
            # Debug info
            parse_debug["item_values"] = [{"text": v['text'], "y": v['y']} for v in item_lines]
            parse_debug["qty_values"] = [{"text": v['text'], "y": v['y']} for v in qty_lines]
            
            # Step 3: Build output rows based on Item positions and Description lines
            # Strategy: Each Item marks a new "item" row. Description lines between items belong to that item.
            # Description lines before any item, or with large gaps AND no item, are "notes"
            
            def find_value_at_y(values: list[dict], y: float, tolerance: float = 15) -> dict | None:
                """Find a value whose Y is close to y"""
                for v in values:
                    if abs(v['y'] - y) <= tolerance:
                        return v
                return None
            
            def parse_number(s: str) -> float | None:
                s = s.replace(",", "").strip()
                try:
                    return float(s)
                except ValueError:
                    return None
            
            # Sort item positions
            item_positions = sorted([(v['y'], v) for v in item_lines], key=lambda x: x[0])
            
            # If no items, everything is notes
            if not item_positions:
                # All description lines are notes
                for line in desc_lines:
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
                        description=line['text'],
                        quantity=None,
                        unit="",
                        rate=None,
                        total=None,
                        bbox_x0=line['x0'],
                        bbox_y0=line['y_top'],
                        bbox_x1=line['x1'],
                        bbox_y1=line['y_bottom']
                    ))
                    row_id += 1
            else:
                # Build description blocks based on Item positions
                # For each Item, collect description lines that are:
                # 1. Within a Y range slightly above to next Item's Y (or page end)
                # 2. Don't have a large paragraph gap
                
                all_blocks = []
                
                # First, any Description lines BEFORE the first Item are notes
                first_item_y = item_positions[0][0]
                notes_before = []
                for line in desc_lines:
                    if line['y_center'] < first_item_y - 20:  # Lines clearly above first item
                        notes_before.append(line)
                
                # Group notes_before by paragraph gaps
                if notes_before:
                    current_block = {'type': 'notes', 'lines': [notes_before[0]], 'y_start': notes_before[0]['y_top'], 'y_end': notes_before[0]['y_bottom']}
                    for i in range(1, len(notes_before)):
                        gap = notes_before[i]['y_top'] - current_block['y_end']
                        if gap > para_threshold:
                            # New notes block
                            all_blocks.append(current_block)
                            current_block = {'type': 'notes', 'lines': [notes_before[i]], 'y_start': notes_before[i]['y_top'], 'y_end': notes_before[i]['y_bottom']}
                        else:
                            current_block['lines'].append(notes_before[i])
                            current_block['y_end'] = notes_before[i]['y_bottom']
                    all_blocks.append(current_block)
                
                # Now process each Item
                for idx, (item_y, item_val) in enumerate(item_positions):
                    # Find the Y range for this item's description
                    y_start = item_y - 10  # Slightly above item to catch same-line description
                    
                    if idx < len(item_positions) - 1:
                        next_item_y = item_positions[idx + 1][0]
                        y_end = next_item_y - 5  # Up to next item
                    else:
                        y_end = dr_y1 + 100  # To page end
                    
                    # Collect description lines in this range
                    item_desc_lines = [l for l in desc_lines if y_start <= l['y_center'] <= y_end]
                    
                    # Find Qty, Unit, Rate, Total for this item
                    qty_val = find_value_at_y(qty_lines, item_y, 20)
                    unit_val = find_value_at_y(unit_lines, item_y, 20)
                    rate_val = find_value_at_y(rate_lines, item_y, 20)
                    total_val = find_value_at_y(total_lines, item_y, 20)
                    
                    all_blocks.append({
                        'type': 'item',
                        'item_no': item_val['text'],
                        'lines': item_desc_lines,
                        'y_start': item_y,
                        'y_end': y_end,
                        'qty': qty_val,
                        'unit': unit_val,
                        'rate': rate_val,
                        'total': total_val,
                        'item_x0': item_val.get('x0', 0),
                        'item_x1': item_val.get('x1', 0),
                    })
                
                # Sort all blocks by y_start
                all_blocks.sort(key=lambda b: b['y_start'])
                
                parse_debug["blocks_count"] = len(all_blocks)
                
                # Create output rows
                for block in all_blocks:
                    if block['type'] == 'notes':
                        desc_text = ' '.join(l['text'] for l in block['lines'])
                        # Calculate bounding box for highlighting
                        if block['lines']:
                            bbox_x0 = min(l['x0'] for l in block['lines'])
                            bbox_x1 = max(l['x1'] for l in block['lines'])
                            bbox_y0 = block['y_start']
                            bbox_y1 = block['y_end']
                        else:
                            bbox_x0 = bbox_x1 = bbox_y0 = bbox_y1 = 0
                        
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
                            description=desc_text,
                            quantity=None,
                            unit="",
                            rate=None,
                            total=None,
                            bbox_x0=bbox_x0,
                            bbox_y0=bbox_y0,
                            bbox_x1=bbox_x1,
                            bbox_y1=bbox_y1
                        ))
                        row_id += 1
                    else:
                        # Item block
                        desc_text = ' '.join(l['text'] for l in block['lines'])
                        qty = parse_number(block['qty']['text']) if block['qty'] else None
                        unit = block['unit']['text'] if block['unit'] else ""
                        rate = parse_number(block['rate']['text']) if block['rate'] else None
                        total = parse_number(block['total']['text']) if block['total'] else None
                        
                        # Calculate bounding box (include Item column for full row coverage)
                        if block['lines']:
                            # Use Item column's x0 as left boundary for full row coverage
                            item_x0 = block.get('item_x0', 0)
                            lines_x0 = min(l['x0'] for l in block['lines'])
                            bbox_x0 = min(item_x0, lines_x0) if item_x0 > 0 else lines_x0
                            bbox_x1 = max(l['x1'] for l in block['lines'])
                            bbox_y0 = min(l['y_top'] for l in block['lines'])
                            bbox_y1 = max(l['y_bottom'] for l in block['lines'])
                        else:
                            bbox_x0 = block.get('item_x0', 0)
                            bbox_x1 = block.get('item_x1', 0)
                            bbox_y0 = block['y_start']
                            bbox_y1 = block['y_end']
                        
                        rows.append(BQRowResponse(
                            id=row_id,
                            file_id=file_id,
                            page_number=page_num,
                            page_label=page_label,
                            revision=revision,
                            bill_name=bill_name,
                            collection=collection,
                            type="item",
                            item_no=block['item_no'],
                            description=desc_text,
                            quantity=qty,
                            unit=unit,
                            rate=rate,
                            total=total,
                            bbox_x0=bbox_x0,
                            bbox_y0=bbox_y0,
                            bbox_x1=bbox_x1,
                            bbox_y1=bbox_y1
                        ))
                        row_id += 1
    
    except ImportError as e:
        parse_debug["error"] = f"ImportError: {str(e)}"
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
    
    except Exception as e:
        # Catch any other exception
        parse_debug["error"] = f"Exception: {type(e).__name__}: {str(e)}"
        logger.error(f"BQ parse error: {e}", exc_info=True)
    
    return rows, parse_debug


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
    
    # Debug info: what boxes were received
    box_names = [b.column_name for b in request.boxes]
    column_boxes = [b.column_name for b in request.boxes if b.column_name in 
                    ["Item", "Description", "Qty", "Unit", "Rate", "Total"]]
    zone_boxes = [b.column_name for b in request.boxes if b.column_name in 
                  ["DataRange", "PageNo", "Revision", "BillName", "Collection"]]
    
    debug_info = {
        "all_boxes_received": box_names,
        "column_boxes": column_boxes,
        "zone_boxes": zone_boxes,
        "missing_columns": [c for c in ["Item", "Description", "Qty", "Unit"] if c not in column_boxes],
    }
    
    # Process each page
    all_rows: list[BQRowResponse] = []
    warnings: list[str] = []
    pages_processed = 0
    parse_debug = {}  # Will be populated from first page
    
    # Add warning if no column boxes defined
    if not column_boxes:
        warnings.append("No column header boxes defined (Item, Description, Qty, Unit, Rate, Total). Please draw column boxes on the PDF.")
    
    for page_num in request.pages:
        try:
            rows, page_debug = _parse_bq_rows(
                file_id=request.file_id,
                page_num=page_num,
                boxes=request.boxes,
                engine=request.engine,
                pdf_path=pdf_path
            )
            
            # Keep parse_debug from first page
            if not parse_debug and page_debug:
                parse_debug = page_debug
            
            # Renumber IDs to be globally unique
            start_id = len(all_rows) + 1
            for i, row in enumerate(rows):
                row.id = start_id + i
            
            all_rows.extend(rows)
            pages_processed += 1
            
        except Exception as e:
            warnings.append(f"Page {page_num + 1}: {str(e)}")
    
    # Merge parse_debug into debug_info
    debug_info["parse_debug"] = parse_debug
    
    # Calculate quota cost
    quota_cost = pages_processed * 1  # 1 point per page for pdfplumber
    if request.engine.startswith("camelot"):
        quota_cost = pages_processed * 3
    
    # Record usage (shared with page OCR quota)
    if quota_cost > 0:
        usage_result = _record_usage(user["uid"], quota_cost)
        if usage_result.get("over_limit"):
            raise HTTPException(
                status_code=429,
                detail=f"Monthly quota exceeded. Usage: {usage_result['usage_pages']}/{usage_result['limit']} pages"
            )
    
    return BQExtractResponse(
        success=True,
        rows=all_rows,
        warnings=warnings,
        engine=request.engine,
        pages_processed=pages_processed,
        quota_cost=quota_cost,
        debug_info=debug_info
    )
