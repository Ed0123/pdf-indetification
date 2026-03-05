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
    # Engine selection for OCR/analysis.  "page_ocr" is a special option that
    # instructs the backend to perform PyMuPDF full-page OCR and then clip the
    # result; this path is trimmed of whitespace.  Other engines (pdfplumber or
    # camelot) are unaffected by this field.
    engine: Literal["pdfplumber", "camelot-lattice", "camelot-stream", "page_ocr"] = "pdfplumber"


class BQRowResponse(BaseModel):
    """A single BQ row in the response."""
    id: int
    file_id: str
    page_number: int
    page_label: str = ""
    revision: str = ""
    bill_name: str = ""
    collection: str = ""
    # page-level collection flag (see `_detect_collection_page`)
    page_is_collection: bool = False
    type: str = "item"  # item, notes, collection_entry, collection_cf, collection_total
    item_no: str = ""
    description: str = ""
    quantity: Optional[float] = None
    unit: str = ""
    rate: Optional[float] = None
    total: Optional[float] = None
    # Parent row id for hierarchy (sub-items point to their parent item)
    parent_id: Optional[int] = None
    # Bounding box for UI highlighting (PDF coordinates)
    bbox_x0: Optional[float] = None
    bbox_y0: Optional[float] = None
    bbox_x1: Optional[float] = None
    bbox_y1: Optional[float] = None
    # Page dimensions for coordinate conversion
    page_width: Optional[float] = None
    page_height: Optional[float] = None


class BQExtractResponse(BaseModel):
    """Response body for BQ extraction.

    The returned ``rows`` list now has a ``page_is_collection`` flag on each
    row; debug_info may contain ``parse_debug.collection_page`` with a
    confidence score from the automatic page‑type classifier.
    """
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


def _normalize_fontname(name: str | None) -> str | None:
    """Strip the 6-char subset prefix (e.g. 'BCDEEE+Arial-Bold' -> 'Arial-Bold')."""
    if not name:
        return name
    if len(name) > 7 and name[6] == '+' and name[:6].isalpha():
        return name[7:]
    return name


# Regex that matches common sub-item prefixes at the start of a line.
# Examples: "* thick", "- allow", "A ", "B. ", "1. ", "(a)", "(i)"
_SUBITEM_PREFIX_RE = re.compile(
    r'^(?:'
    r'\*\s'            # asterisk:   "* thick"
    r'|\-\s'           # dash:       "- allow"
    r'|[A-Z]\.?\s'     # letter:     "A ", "B. "
    r'|[0-9]+\.\s'     # number:     "1. ", "12. "
    r'|\([a-z0-9]+\)'  # paren:      "(a)", "(i)", "(1)"
    r')'
)


def _has_subitem_prefix(text: str) -> bool:
    """Return True if *text* starts with a sub-item prefix pattern."""
    return bool(_SUBITEM_PREFIX_RE.match(text))


def _is_bold_font(fontname: str | None) -> bool:
    """Heuristic: does the normalised font name suggest bold weight?"""
    if not fontname:
        return False
    norm = _normalize_fontname(fontname)
    if not norm:
        return False
    return 'bold' in norm.lower()


def _classify_line_type(line: dict, median_size: float | None = None) -> str:
    """Classify a single Description line as 'item' or 'notes'.

    Simplified: no heading1/heading2/sub-item categories.
    """
    return 'item'


# ---------------------------------------------------------------------------
# Collection page detection helpers
# ---------------------------------------------------------------------------

# keyword lists used by _is_collection_page; kept outside function for coverage
_POSITIVE_COLLECTION_KEYWORDS = [
    "summary",
    "collection",
    "total",
    "grand total",
    "subtotal",
    "aggregation",
    "recap",
    "bill summary",
    "carried to summary",
    "collection of bill",
    "collection from page",
]
_NEGATIVE_ITEM_KEYWORDS = [
    "item",
    "description",
    "unit",
    "qty",
    "quantity",
    "rate",
    "amount",
    "provisional sum",
]


def _is_collection_page(words: list[dict], page_width: float | None = None, page_height: float | None = None) -> tuple[bool, float]:
    """Simple rule-based classifier for BQ "collection" (summary) pages.

    *words* should be the raw OCR output from ``pdfplumber`` (see
    :func:`_parse_bq_rows`).  Only the ``'text'`` attribute is required, but
    ``x0``/``x1``/``'top``/``'bottom`` are used for a couple of geometric
    heuristics.

    Returns ``(is_collection, confidence)`` where confidence is a float in
    ``[0,1]``.  The implementation follows the feature spec provided in the
    engineering task: keyword matching, numeric density, layout sparsity, and
    crude header/footer detection.  The scoring weights are arbitrary but
    intended to prefer pages containing obvious summary keywords and relatively
    few descriptive words.
    """
    import re
    from difflib import SequenceMatcher

    score = 0.0
    total = len(words)
    if total == 0:
        return False, 0.0

    lower_texts = [w.get("text", "").strip().lower() for w in words]

    # keyword counts
    pos_count = 0
    neg_count = 0
    for t in lower_texts:
        for kw in _POSITIVE_COLLECTION_KEYWORDS:
            if kw in t:
                pos_count += 1
            else:
                # fuzzy match: simple ratio threshold
                if SequenceMatcher(None, t, kw).ratio() > 0.8:
                    pos_count += 1
        for kw in _NEGATIVE_ITEM_KEYWORDS:
            if kw in t:
                neg_count += 1
            else:
                if SequenceMatcher(None, t, kw).ratio() > 0.8:
                    neg_count += 1

    has_pos = pos_count > 0
    has_neg = neg_count > 0

    # numeric ratio
    num_re = re.compile(r"^[\d,.]+$")
    numeric_count = sum(1 for t in lower_texts if num_re.match(t.replace(" ", "")))
    numeric_ratio = numeric_count / total

    # layout density (texts per unit area)
    layout_density = 0.0
    if page_width and page_height and page_width > 0 and page_height > 0:
        layout_density = total / (page_width * page_height)

    # header/footer heuristics
    has_header_kw = False
    has_footer_kw = False
    if page_height and page_height > 0:
        for w in words:
            y_center = (w.get("top", 0) + w.get("bottom", 0)) / 2
            t = w.get("text", "").strip().lower()
            if y_center < page_height * 0.2 and any(kw in t for kw in _POSITIVE_COLLECTION_KEYWORDS):
                has_header_kw = True
            if y_center > page_height * 0.8 and any(kw in t for kw in _POSITIVE_COLLECTION_KEYWORDS):
                has_footer_kw = True

    # scoring rules (weights loosely based on spec)
    # presence of any positive keyword is the strongest single indicator
    if pos_count >= 1:
        score += 0.5
    elif pos_count > 1:
        score += 0.4
    if has_header_kw or has_footer_kw:
        score += 0.2
    if numeric_ratio > 0.3:
        score += 0.1
    if layout_density < 0.0001:
        score += 0.1
    # ensure we still penalise obvious non-summary pages
    if has_neg:
        score -= 0.3

    confidence = max(0.0, min(1.0, score))
    return confidence > 0.6, confidence


# ---------------------------------------------------------------------------
# Collection page entry parsing
# ---------------------------------------------------------------------------

# Regex patterns for carry-forward / brought-forward keywords
_CARRY_FORWARD_RE = re.compile(
    r'(?:carried?\s+forward|carry\s+forward|c/?f|to\s+next\s+page|carried\s+to)',
    re.IGNORECASE,
)
_BROUGHT_FORWARD_RE = re.compile(
    r'(?:brought?\s+forward|bring\s+forward|b/?f|from\s+previous|from\s+last)',
    re.IGNORECASE,
)

# Regex for page reference patterns like "MODBQ.15/1", "BQ.4/2", "Page 5", etc.
_PAGE_REF_RE = re.compile(
    r'(?:'
    r'(?:page\s*(?:no\.?\s*)?)?'       # optional "Page No."
    r'([A-Z]{2,}[\w]*\.[\d]+/[\d]+)'   # e.g. MODBQ.15/1, BQ.4/2
    r'|page\s*(?:no\.?\s*)?(\d+)'      # e.g. "Page 5", "Page No. 3"
    r'|(\d+(?:\.\d+)+/\d+)'            # bare numeric ref e.g. 4.4/1, 4.5/1
    r')',
    re.IGNORECASE,
)

# Regex for currency/number extraction
_CURRENCY_NUM_RE = re.compile(
    r'[\$]?\s*(\d{1,3}(?:,\d{3})*(?:\.\d+)?)'
)


def _parse_collection_entries(
    desc_lines: list[dict],
    total_lines: list[dict],
) -> list[dict]:
    """Parse collection page lines to extract page reference entries.

    Returns a list of dicts:
      { 'description': str, 'page_ref': str, 'total': float|None,
        'entry_type': 'page_ref'|'carry_forward'|'brought_forward'|'grand_total'|'other',
        'lines': list[dict] }
    """
    entries: list[dict] = []

    def _find_total_at_y(y: float, tolerance: float = 15) -> float | None:
        for t in total_lines:
            if abs(t['y'] - y) <= tolerance:
                text = t['text'].replace(",", "").replace("$", "").strip()
                try:
                    return float(text)
                except ValueError:
                    return None
        return None

    for line in desc_lines:
        text = line['text']
        y = line['y_center']
        entry: dict = {
            'description': text,
            'page_ref': '',
            'total': _find_total_at_y(y),
            'entry_type': 'other',
            'lines': [line],
        }

        # Check for page reference patterns
        ref_match = _PAGE_REF_RE.search(text)
        if ref_match:
            page_ref = ref_match.group(1) or ref_match.group(2) or ref_match.group(3)
            if page_ref:
                entry['page_ref'] = page_ref
                entry['entry_type'] = 'page_ref'

        # Check for carry-forward
        if _CARRY_FORWARD_RE.search(text):
            entry['entry_type'] = 'carry_forward'
        # Check for brought-forward
        elif _BROUGHT_FORWARD_RE.search(text):
            entry['entry_type'] = 'brought_forward'
        # Check for grand total
        elif re.search(r'grand\s*total', text, re.IGNORECASE):
            entry['entry_type'] = 'grand_total'

        # If no total found from total column, try extracting from the line itself
        if entry['total'] is None:
            # Look for trailing number in the description (common in collection pages)
            num_match = _CURRENCY_NUM_RE.findall(text)
            if num_match:
                try:
                    entry['total'] = float(num_match[-1].replace(",", ""))
                except ValueError:
                    pass

        entries.append(entry)

    return entries


def _detect_underlines(page, bbox: tuple) -> list[dict]:
    """Return horizontal graphic elements (lines/thin rects) within *bbox* that
    likely represent text underlines.

    Each returned dict has keys ``x0, x1, y`` (the vertical centre of the stroke).

    Strategy: collect ``page.lines`` (explicit strokes) and ``page.rects`` whose
    height ≤ 2 pt (drawn-as-rect underlines).  Only elements that are roughly
    horizontal (height ≤ 2 pt) and fall inside *bbox* are kept.
    """
    x0b, y0b, x1b, y1b = bbox
    result: list[dict] = []

    for line in (page.lines or []):
        lx0, ly0, lx1, ly1 = line['x0'], line['top'], line['x1'], line['bottom']
        height = abs(ly1 - ly0)
        if height > 2:
            continue
        mid_y = (ly0 + ly1) / 2
        if mid_y < y0b or mid_y > y1b:
            continue
        if lx1 < x0b or lx0 > x1b:
            continue
        result.append({'x0': lx0, 'x1': lx1, 'y': mid_y})

    for rect in (page.rects or []):
        rx0, ry0, rx1, ry1 = rect['x0'], rect['top'], rect['x1'], rect['bottom']
        height = abs(ry1 - ry0)
        if height > 2:
            continue
        mid_y = (ry0 + ry1) / 2
        if mid_y < y0b or mid_y > y1b:
            continue
        if rx1 < x0b or rx0 > x1b:
            continue
        result.append({'x0': rx0, 'x1': rx1, 'y': mid_y})

    return result


def _is_word_underlined(word: dict, underlines: list[dict], tolerance: float = 3.0) -> bool:
    """Check whether *word* is underlined by any element in *underlines*.

    An underline must be within *tolerance* pt below the word's bottom edge
    and its horizontal extent must overlap the word's x-range by ≥ 50 %.
    """
    wx0, wx1, wbottom = word['x0'], word['x1'], word['bottom']
    word_width = wx1 - wx0
    if word_width <= 0:
        return False
    for ul in underlines:
        # Vertical check: underline y should be near or just below the word bottom
        if ul['y'] < wbottom - tolerance or ul['y'] > wbottom + tolerance:
            continue
        # Horizontal overlap check
        overlap = max(0, min(wx1, ul['x1']) - max(wx0, ul['x0']))
        if overlap >= word_width * 0.5:
            return True
    return False


def _should_split_block(prev_line: dict, curr_line: dict, para_threshold: float) -> tuple[bool, str]:
    """Decide whether two consecutive lines should be in separate blocks.

    Returns (should_split, reason) where reason is '' or one of
    'style', 'indent', 'gap', 'subitem', 'sub_indent'.

    Priority order:
      style > subitem > indent / sub_indent > gap
    """
    # 1. Font / size change (includes underline difference)
    prev_font = _normalize_fontname(prev_line.get('fontname'))
    curr_font = _normalize_fontname(curr_line.get('fontname'))
    if prev_font is not None and curr_font is not None and prev_font != curr_font:
        return True, 'style'
    if abs((prev_line.get('size') or 0) - (curr_line.get('size') or 0)) > 0.5:
        return True, 'style'
    # Underline mismatch
    prev_ul = prev_line.get('underline', False)
    curr_ul = curr_line.get('underline', False)
    if prev_ul != curr_ul:
        return True, 'style'

    # 2. Sub-item prefix detection — even without a gap, a recognised prefix
    #    (*, -, A., 1., etc.) at the start of the current line triggers a split.
    curr_text = curr_line.get('text', '')
    if _has_subitem_prefix(curr_text):
        return True, 'subitem'

    # 3. Indentation / left-edge shift
    prev_height = prev_line['y_bottom'] - prev_line['y_top']
    curr_height = curr_line['y_bottom'] - curr_line['y_top']
    x_diff = abs(curr_line['x0'] - prev_line['x0'])

    if prev_height <= 0 or curr_height <= 0:
        # revert to legacy heuristics
        avg_width = ((prev_line['x1'] - prev_line['x0']) + (curr_line['x1'] - curr_line['x0'])) / 2
        x_threshold = max(30, avg_width * 0.2)
        if x_diff > x_threshold:
            return True, 'indent'
        gap = curr_line['y_top'] - prev_line['y_bottom']
        if gap > para_threshold:
            return True, 'gap'
        return False, ''

    # Full paragraph indent: 1.5×height
    if x_diff > prev_height * 1.5:
        return True, 'indent'

    # Sub-indent: smaller shift (1.0×height) combined with the current line
    # being indented *further right* than the previous line.
    if curr_line['x0'] > prev_line['x0'] and x_diff > prev_height * 1.0:
        return True, 'sub_indent'

    # 4. Vertical gap: half the average line height
    gap = curr_line['y_top'] - prev_line['y_bottom']
    height_avg = (prev_height + curr_height) / 2
    gap_threshold = height_avg * 0.5
    if gap > gap_threshold:
        return True, 'gap'

    return False, ''


def _extract_text_from_box(pdf_path: str, page_num: int, box: BoxDefinition, engine: str = "pdfplumber") -> str:
    """Extract text from a specific box region on a PDF page.

    The *engine* parameter currently controls which backend is used for
    BQ parsing; most values (``pdfplumber``, ``camelot-*``) ignore this and
    simply let the caller decide later.  We add a special ``"page_ocr"``
    value which performs OCR on the whole page using PyMuPDF's
    ``get_textpage_ocr`` API, then clips and returns the portion inside the
    requested box.  Whitespace is always trimmed from the result.
    """
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

    # page OCR path
    if engine == "page_ocr":
        try:
            if hasattr(page, "get_textpage_ocr"):
                tp = page.get_textpage_ocr(flags=0, full=False)
                text = page.get_text("text", clip=clip_rect, textpage=tp)
                doc.close()
                return text.strip()
        except Exception:
            # If OCR fails for any reason fall back to normal extraction below
            pass

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
            
            # Extract words from DataRange (include font attributes for style splitting)
            cropped = page.within_bbox(dr_bbox)
            words = cropped.extract_words(
                keep_blank_chars=True, y_tolerance=3, x_tolerance=3,
                extra_attrs=['fontname', 'size'],
            )

            # Detect underline graphic elements inside the DataRange
            underlines = _detect_underlines(page, dr_bbox)
            parse_debug["underline_elements"] = len(underlines)
            
            parse_debug["words_extracted"] = len(words)
            
            # Collection page detection (new feature)
            is_coll, coll_conf = _is_collection_page(words, page_width, page_height)
            parse_debug["collection_page"] = {
                "is_collection": is_coll,
                "confidence": coll_conf,
            }
            
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
                
                word_entry = {
                    'text': text,
                    'y': word_y_mid,
                    'y_top': w['top'],
                    'y_bottom': w['bottom'],
                    'x0': w['x0'],
                    'x1': w['x1'],
                    'fontname': w.get('fontname'),
                    'size': w.get('size'),
                    'underline': _is_word_underlined(w, underlines),
                }
                
                assigned = False
                for col_name, (cx0, cx1) in col_x_ranges.items():
                    if cx0 <= word_x_mid < cx1:  # Note: < not <= for right boundary
                        col_words[col_name].append(word_entry)
                        assigned = True
                        break
                
                if not assigned:
                    col_words["_unassigned"].append(word_entry)
            
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
            desc_lines: list[dict] = []  # [{texts: [], y_top, y_bottom, y_center, styles,...}]

            for word in desc_words:
                if not desc_lines:
                    desc_lines.append({
                        'texts': [word['text']],
                        'y_top': word['y_top'],
                        'y_bottom': word['y_bottom'],
                        'y_center': word['y'],
                        'x0': word['x0'],
                        'x1': word['x1'],
                        'word_count': 1,
                        'fontnames': [word.get('fontname')],
                        'sizes': [word.get('size')],
                        'underlines': [word.get('underline', False)],
                    })
                else:
                    last_line = desc_lines[-1]
                    # Same line if Y is very close
                    if abs(word['y'] - last_line['y_center']) <= line_y_tolerance:
                        last_line['texts'].append(word['text'])
                        last_line['x0'] = min(last_line['x0'], word['x0'])
                        last_line['x1'] = max(last_line['x1'], word['x1'])
                        last_line['y_top'] = min(last_line['y_top'], word['y_top'])
                        last_line['y_bottom'] = max(last_line['y_bottom'], word['y_bottom'])
                        # Update y_center as running average
                        old_count = last_line['word_count']
                        last_line['y_center'] = (last_line['y_center'] * old_count + word['y']) / (old_count + 1)
                        last_line['word_count'] = old_count + 1
                        # accumulate styles
                        last_line['fontnames'].append(word.get('fontname'))
                        last_line['sizes'].append(word.get('size'))
                        last_line['underlines'].append(word.get('underline', False))
                    else:
                        # New line
                        desc_lines.append({
                            'texts': [word['text']],
                            'y_top': word['y_top'],
                            'y_bottom': word['y_bottom'],
                            'y_center': word['y'],
                            'x0': word['x0'],
                            'x1': word['x1'],
                            'word_count': 1,
                            'fontnames': [word.get('fontname')],
                            'sizes': [word.get('size')],
                            'underlines': [word.get('underline', False)],
                        })

            # Finalize line text and compute a representative style
            for line in desc_lines:
                line['text'] = ' '.join(line['texts'])
                # most common fontname and average size
                if line.get('fontnames'):
                    line['fontname'] = max(set(line['fontnames']), key=line['fontnames'].count)
                else:
                    line['fontname'] = None
                if line.get('sizes'):
                    line['size'] = sum([s or 0 for s in line['sizes']]) / len(line['sizes'])
                else:
                    line['size'] = None
                # majority-vote underline status for the line
                uls = line.get('underlines', [])
                line['underline'] = sum(uls) > len(uls) / 2 if uls else False
            
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
            # Counters for style/indent driven splits (populated below)
            style_splits = 0
            indent_splits = 0
            
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
            # Strategy:
            #   • Each Item column value marks a new "item" row.
            #   • Description lines between items are split further into
            #     sub-items (prefix / indent), headings (bold/underline),
            #     or continuation lines.
            #   • Lines before the first item are notes/headings.
            #   • parent_id links sub-items back to their parent item row.
            
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

            def _clean_description(text: str) -> str:
                """Post-process a joined description string."""
                # Remove stray semicolons left from OCR line-break joining
                text = re.sub(r'\s*;\s*$', '', text)
                text = re.sub(r'^\s*;\s*', '', text)
                return text.strip()

            def _merge_short_continuation(lines: list[dict], threshold_words: int = 3) -> list[list[dict]]:
                """Group *lines* into sub-blocks, merging short continuation
                lines (≤ *threshold_words* words without a sub-item prefix and
                with a small gap) into the preceding sub-block.

                Returns a list of sub-block groups (each a list of lines).
                """
                if not lines:
                    return []
                groups: list[list[dict]] = [[lines[0]]]
                for i in range(1, len(lines)):
                    prev = lines[i - 1]
                    curr = lines[i]
                    split, reason = _should_split_block(prev, curr, para_threshold)
                    if split:
                        groups.append([curr])
                    else:
                        groups[-1].append(curr)
                # Second pass: merge tiny groups (≤ threshold_words total,
                # no prefix) back into the *previous* group.
                merged: list[list[dict]] = [groups[0]]
                for g in groups[1:]:
                    combined_text = ' '.join(l['text'] for l in g)
                    if (len(combined_text.split()) <= threshold_words
                            and not _has_subitem_prefix(combined_text)):
                        merged[-1].extend(g)
                    else:
                        merged.append(g)
                return merged

            # Compute median font size across all desc lines for heading detection
            all_sizes = [l.get('size') for l in desc_lines if l.get('size')]
            median_size = sorted(all_sizes)[len(all_sizes) // 2] if all_sizes else None

            # Sort item positions
            item_positions = sorted([(v['y'], v) for v in item_lines], key=lambda x: x[0])
            
            # Helper: create a BQRowResponse with common fields filled in
            def _make_row(*, row_type: str, desc: str, item_no: str = "",
                          qty=None, unit="", rate=None, total=None,
                          parent_id_val=None,
                          lines_for_bbox: list[dict] | None = None,
                          item_x0: float = 0, item_x1: float = 0,
                          fallback_y_start: float = 0, fallback_y_end: float = 0) -> BQRowResponse:
                nonlocal row_id
                if lines_for_bbox:
                    bx0 = min(l['x0'] for l in lines_for_bbox)
                    bx1 = max(l['x1'] for l in lines_for_bbox)
                    by0 = min(l['y_top'] for l in lines_for_bbox)
                    by1 = max(l['y_bottom'] for l in lines_for_bbox)
                    if item_x0 > 0:
                        bx0 = min(bx0, item_x0)
                else:
                    bx0 = item_x0
                    bx1 = item_x1
                    by0 = fallback_y_start
                    by1 = fallback_y_end
                r = BQRowResponse(
                    id=row_id,
                    file_id=file_id,
                    page_number=page_num,
                    page_label=page_label,
                    revision=revision,
                    bill_name=bill_name,
                    collection=collection,
                    page_is_collection=is_coll,
                    type=row_type,
                    item_no=item_no,
                    description=_clean_description(desc),
                    quantity=qty,
                    unit=unit,
                    rate=rate,
                    total=total,
                    parent_id=parent_id_val,
                    bbox_x0=bx0, bbox_y0=by0, bbox_x1=bx1, bbox_y1=by1,
                    page_width=page_width, page_height=page_height,
                )
                row_id += 1
                return r

            # ── Collection page → parse as collection entries ──
            if is_coll:
                coll_entries = _parse_collection_entries(desc_lines, total_lines)
                parse_debug["collection_entries"] = len(coll_entries)

                for entry in coll_entries:
                    etype = entry['entry_type']
                    # Map entry_type to row type
                    if etype == 'page_ref':
                        row_type = 'collection_entry'
                    elif etype in ('carry_forward', 'brought_forward'):
                        row_type = 'collection_cf'
                    elif etype == 'grand_total':
                        row_type = 'collection_total'
                    else:
                        # Non-page-ref entries on collection pages → notes
                        row_type = 'notes'

                    rows.append(_make_row(
                        row_type=row_type,
                        desc=entry['description'],
                        item_no=entry.get('page_ref', ''),
                        total=entry.get('total'),
                        lines_for_bbox=entry.get('lines') or None,
                    ))

            # ── No items on page → emit headings / notes ──
            elif not item_positions:
                for line in desc_lines:
                    rows.append(_make_row(
                        row_type='notes', desc=line['text'],
                        lines_for_bbox=[line],
                    ))

            else:
                # ── Build blocks from description lines ──
                all_blocks: list[dict] = []
                assigned_lines: set[int] = set()

                # Lines BEFORE the first item → notes/headings
                first_item_y = item_positions[0][0]
                notes_before = [l for l in desc_lines if l['y_center'] < first_item_y - 10]
                for l in notes_before:
                    assigned_lines.add(id(l))

                if notes_before:
                    current_block = {'type': 'notes', 'lines': [notes_before[0]], 'y_start': notes_before[0]['y_top'], 'y_end': notes_before[0]['y_bottom']}
                    for i in range(1, len(notes_before)):
                        curr = notes_before[i]
                        prev = current_block['lines'][-1]
                        split, reason = _should_split_block(prev, curr, para_threshold)
                        if reason == 'style': style_splits += 1
                        if reason == 'indent': indent_splits += 1
                        if split:
                            all_blocks.append(current_block)
                            current_block = {'type': 'notes', 'lines': [curr], 'y_start': curr['y_top'], 'y_end': curr['y_bottom']}
                        else:
                            current_block['lines'].append(curr)
                            current_block['y_end'] = curr['y_bottom']
                    all_blocks.append(current_block)

                # ── Process each Item ──
                for idx, (item_y, item_val) in enumerate(item_positions):
                    y_start = item_y - 5
                    if idx < len(item_positions) - 1:
                        y_end = item_positions[idx + 1][0] - 5
                    else:
                        y_end = dr_y1 + 100

                    candidate_lines = sorted(
                        [l for l in desc_lines
                         if y_start <= l['y_center'] <= y_end and id(l) not in assigned_lines],
                        key=lambda l: l['y_center'],
                    )

                    # Collect ALL lines for this item (don't break early),
                    # then split them into sub-blocks.
                    item_all_lines: list[dict] = []
                    for i, line in enumerate(candidate_lines):
                        item_all_lines.append(line)
                        assigned_lines.add(id(line))

                    # Build sub-blocks using _should_split_block
                    sub_blocks = _merge_short_continuation(item_all_lines)

                    # Find Qty, Unit, Rate, Total for this item
                    qty_val = find_value_at_y(qty_lines, item_y, 20)
                    unit_val = find_value_at_y(unit_lines, item_y, 20)
                    rate_val = find_value_at_y(rate_lines, item_y, 20)
                    total_val = find_value_at_y(total_lines, item_y, 20)

                    all_blocks.append({
                        'type': 'item',
                        'item_no': item_val['text'],
                        'sub_blocks': sub_blocks,
                        'lines': item_all_lines,
                        'y_start': item_y,
                        'y_end': y_end,
                        'qty': qty_val,
                        'unit': unit_val,
                        'rate': rate_val,
                        'total': total_val,
                        'item_x0': item_val.get('x0', 0),
                        'item_x1': item_val.get('x1', 0),
                    })

                # Unassigned lines → trailing notes
                unassigned = [l for l in desc_lines if id(l) not in assigned_lines]
                if unassigned:
                    unassigned.sort(key=lambda l: l['y_center'])
                    current_block = {'type': 'notes', 'lines': [unassigned[0]], 'y_start': unassigned[0]['y_top'], 'y_end': unassigned[0]['y_bottom']}
                    for i in range(1, len(unassigned)):
                        curr = unassigned[i]
                        prev = current_block['lines'][-1]
                        split, reason = _should_split_block(prev, curr, para_threshold)
                        if reason == 'style': style_splits += 1
                        if reason == 'indent': indent_splits += 1
                        if split:
                            all_blocks.append(current_block)
                            current_block = {'type': 'notes', 'lines': [curr], 'y_start': curr['y_top'], 'y_end': curr['y_bottom']}
                        else:
                            current_block['lines'].append(curr)
                            current_block['y_end'] = curr['y_bottom']
                    all_blocks.append(current_block)

                # Sort all blocks by y_start
                all_blocks.sort(key=lambda b: b['y_start'])

                parse_debug["blocks_count"] = len(all_blocks)
                parse_debug["style_splits"] = style_splits
                parse_debug["indent_splits"] = indent_splits

                # ── Create output rows with hierarchy ──
                for block in all_blocks:
                    if block['type'] == 'notes':
                        # All notes lines are just 'notes'
                        for line in sorted(block['lines'], key=lambda l: l['y_center']):
                            rows.append(_make_row(
                                row_type='notes',
                                desc=line['text'],
                                lines_for_bbox=[line],
                            ))
                    else:
                        # Item block with sub-blocks
                        qty = parse_number(block['qty']['text']) if block['qty'] else None
                        unit = block['unit']['text'] if block['unit'] else ""
                        rate = parse_number(block['rate']['text']) if block['rate'] else None
                        total = parse_number(block['total']['text']) if block['total'] else None

                        sub_blocks = block.get('sub_blocks', [])
                        has_sub_items = len(sub_blocks) > 1

                        if not has_sub_items:
                            # Single block → emit one "item" row (same as before)
                            sorted_lines = sorted(block['lines'], key=lambda l: l['y_center'])
                            desc_text = ' ; '.join(l['text'] for l in sorted_lines)
                            rows.append(_make_row(
                                row_type='item',
                                desc=desc_text,
                                item_no=block['item_no'],
                                qty=qty, unit=unit, rate=rate, total=total,
                                lines_for_bbox=block['lines'] or None,
                                item_x0=block.get('item_x0', 0),
                                item_x1=block.get('item_x1', 0),
                                fallback_y_start=block['y_start'],
                                fallback_y_end=block['y_end'],
                            ))
                        else:
                            # Multiple sub-blocks → first is the item, rest are notes
                            first_sub = sub_blocks[0]
                            main_desc = ' ; '.join(l['text'] for l in first_sub)

                            parent_row = _make_row(
                                row_type='item',
                                desc=main_desc,
                                item_no=block['item_no'],
                                qty=qty, unit=unit, rate=rate, total=total,
                                lines_for_bbox=block['lines'] or None,
                                item_x0=block.get('item_x0', 0),
                                item_x1=block.get('item_x1', 0),
                                fallback_y_start=block['y_start'],
                                fallback_y_end=block['y_end'],
                            )
                            rows.append(parent_row)

                            # Remaining sub-blocks → notes (no item_no copy, no parent_id)
                            for sb in sub_blocks[1:]:
                                sb_desc = ' ; '.join(l['text'] for l in sb)
                                rows.append(_make_row(
                                    row_type='notes',
                                    desc=sb_desc,
                                    lines_for_bbox=sb,
                                ))
    
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
                page_is_collection=is_coll,
                type="notes",
                item_no="",
                description=line,
                quantity=None,
                unit="",
                rate=None,
                total=None,
                page_width=None,
                page_height=None
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
    from utils.pdf_processing import is_ocr_available

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
        BQEngineInfo(
            id="page_ocr",
            name="Page OCR (PyMuPDF)",
            quota_cost=1,
            available=is_ocr_available(),
            description="OCR the entire page and clip results; useful when no vector text exists."
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
            
            # Add warning if no words extracted (possible DataRange issue)
            if page_debug and page_debug.get("words_extracted", 0) == 0:
                warnings.append(f"Page {page_num + 1}: No text extracted from DataRange. Check that the DataRange box is positioned correctly over the text area.")
            
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


# ─── Collection Integration ───────────────────────────────────────────────────

class PageTotalEntry(BaseModel):
    """Page total data for collection integration."""
    page_key: str           # e.g. "file123-5"
    page_label: str         # e.g. "MODBQ.15/1"
    page_number: int
    file_id: str
    page_total: float
    item_count: int
    is_collection: bool = False


class CollectionIntegrateRequest(BaseModel):
    """Request to integrate page totals into collection pages."""
    page_totals: list[PageTotalEntry]


class CollectionRow(BaseModel):
    """A row in the integrated collection output."""
    page_key: str
    row_id: int
    entry_type: str         # 'page_ref', 'carry_forward', 'brought_forward', 'grand_total', 'heading', 'notes'
    description: str
    page_ref: str = ""      # Referenced page label (e.g. "MODBQ.15/1")
    matched_page_key: str = ""  # Key of the matched page
    total: Optional[float] = None
    original_total: Optional[float] = None  # OCR-extracted total (for validation)
    mismatch_warning: str = ""


class CollectionIntegrateResponse(BaseModel):
    """Response with integrated collection data."""
    success: bool
    collection_rows: list[CollectionRow] = []
    grand_total: float = 0.0
    non_collection_total: float = 0.0
    warnings: list[str] = []


@router.post("/integrate-collection", response_model=CollectionIntegrateResponse)
async def integrate_collection(
    request: CollectionIntegrateRequest,
    user: dict = Depends(require_auth),
):
    """Integrate page totals into collection pages.

    Takes page totals from all pages, computes the grand total from
    non-collection pages only, and returns mapping info for collection
    page rows to reference the correct page totals.
    """
    _check_bq_permission(user)

    warnings: list[str] = []
    collection_rows: list[CollectionRow] = []

    # Build lookup: page_label -> PageTotalEntry
    label_lookup: dict[str, PageTotalEntry] = {}
    for pt in request.page_totals:
        if pt.page_label:
            label_lookup[pt.page_label] = pt

    # Calculate non-collection total
    non_collection_total = sum(
        pt.page_total for pt in request.page_totals if not pt.is_collection
    )

    # For collection pages, try to match entries to page totals
    # This is returned so the frontend can reconstruct the collection table
    row_id = 1
    for pt in request.page_totals:
        if not pt.is_collection:
            continue

        # This collection page will have its rows handled by the frontend
        # We just provide the mapping data
        collection_rows.append(CollectionRow(
            page_key=pt.page_key,
            row_id=row_id,
            entry_type="collection_page",
            description=f"Collection Page: {pt.page_label}",
            page_ref=pt.page_label,
            total=pt.page_total,
        ))
        row_id += 1

    return CollectionIntegrateResponse(
        success=True,
        collection_rows=collection_rows,
        grand_total=non_collection_total,
        non_collection_total=non_collection_total,
        warnings=warnings,
    )
