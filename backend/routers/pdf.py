"""PDF router – upload, render, and text extraction endpoints."""

import os
import uuid
import base64
import tempfile
import shutil
from typing import Dict, List

from fastapi import APIRouter, UploadFile, File, HTTPException, Query, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from backend.auth_middleware import require_auth
from backend.firebase_setup import get_db

# In-memory store: file_id -> absolute path on disk
_STORE: Dict[str, str] = {}

# Maximum upload size per file: 200 MB
MAX_FILE_SIZE = 200 * 1024 * 1024


def _get_path(file_id: str) -> str:
    """Resolve a file_id to a real path, raising 404 if unknown."""
    path = _STORE.get(file_id)
    if not path or not os.path.exists(path):
        raise HTTPException(status_code=404, detail=f"File '{file_id}' not found.")
    return path


def _get_project_limit_and_usage_bytes(uid: str) -> tuple[int, int]:
    """Return (limit_bytes, current_usage_bytes) for current workspace.

    - limit_bytes = -1 means unlimited
    - usage is best-effort from the user's current cloud project metadata
    """
    db = get_db()
    user_snap = db.collection("users").document(uid).get()
    if not user_snap.exists:
        return 200 * 1024 * 1024, 0

    user_data = user_snap.to_dict()
    tier_name = user_data.get("tier", "basic")

    limit_mb = 200
    for t in db.collection("tiers").stream():
        td = t.to_dict()
        if td.get("name") == tier_name:
            limit_mb = td.get("project_size_mb", 200)
            break

    if limit_mb == -1:
        limit_bytes = -1
    else:
        limit_bytes = max(0, int(limit_mb)) * 1024 * 1024

    usage_bytes = 0
    try:
        docs = db.collection("cloud_projects").where("owner_uid", "==", uid).stream()
        for d in docs:
            data = d.to_dict()
            if data.get("is_current"):
                usage_bytes = int(data.get("size_bytes", 0) or 0)
                break
    except Exception:
        usage_bytes = 0

    return limit_bytes, usage_bytes


router = APIRouter()


# ---------------------------------------------------------------------------
# Upload
# ---------------------------------------------------------------------------

class PageInfo(BaseModel):
    page_number: int


class FileInfo(BaseModel):
    file_id: str
    file_name: str
    num_pages: int
    file_size: int
    pages: List[PageInfo]


@router.post("/upload", response_model=List[FileInfo], summary="Upload PDF files")
async def upload_pdfs(files: List[UploadFile] = File(...), user: dict = Depends(require_auth)):
    """
    Accept one or more PDF files.
    Stores them in a server-side temp directory and returns metadata.
    """
    import fitz  # PyMuPDF

    results: List[FileInfo] = []
    tmp_dir = tempfile.mkdtemp(prefix="pdf_upload_")

    total_incoming_bytes = 0
    loaded_contents: list[tuple[UploadFile, bytes]] = []
    for upload in files:
        content = await upload.read()
        total_incoming_bytes += len(content)
        loaded_contents.append((upload, content))

    limit_bytes, usage_bytes = _get_project_limit_and_usage_bytes(user["uid"])
    if limit_bytes != -1 and (usage_bytes + total_incoming_bytes) > limit_bytes:
        limit_mb = limit_bytes // (1024 * 1024)
        raise HTTPException(
            status_code=413,
            detail=f"Project size limit exceeded (limit {limit_mb} MB). Please start a new workspace or remove files.",
        )

    for upload, content in loaded_contents:
        if not upload.filename or not upload.filename.lower().endswith(".pdf"):
            continue

        file_id = str(uuid.uuid4())
        dest = os.path.join(tmp_dir, f"{file_id}.pdf")

        if len(content) > MAX_FILE_SIZE:
            raise HTTPException(
                status_code=413,
                detail=f"File '{upload.filename}' exceeds maximum size of {MAX_FILE_SIZE // (1024*1024)} MB"
            )
        with open(dest, "wb") as f:
            f.write(content)

        try:
            doc = fitz.open(dest)
            num_pages = len(doc)
            doc.close()
        except Exception as exc:
            os.remove(dest)
            raise HTTPException(status_code=422, detail=f"Cannot open PDF '{upload.filename}': {exc}")

        _STORE[file_id] = dest
        results.append(FileInfo(
            file_id=file_id,
            file_name=upload.filename,
            num_pages=num_pages,
            file_size=len(content),
            pages=[PageInfo(page_number=i) for i in range(num_pages)],
        ))

    if not results:
        raise HTTPException(status_code=422, detail="No valid PDF files found in upload.")

    return results


# ---------------------------------------------------------------------------
# Render page
# ---------------------------------------------------------------------------

@router.get("/{file_id}/page/{page_num}/render", summary="Render a PDF page as PNG")
def render_page(
    file_id: str,
    page_num: int,
    zoom: float = Query(default=1.5, ge=0.1, le=5.0),
    user: dict = Depends(require_auth),
):
    """Return the requested page rendered as a base64-encoded PNG."""
    from utils.pdf_processing import render_pdf_page

    path = _get_path(file_id)
    img_bytes = render_pdf_page(path, page_num, zoom=zoom)
    if img_bytes is None:
        raise HTTPException(status_code=404, detail=f"Page {page_num} not found.")

    encoded = base64.b64encode(img_bytes).decode()
    return {"image": encoded, "page_num": page_num}


# ---------------------------------------------------------------------------
# Extract text
# ---------------------------------------------------------------------------

class ExtractRequest(BaseModel):
    x: float       # relative 0-1
    y: float
    width: float
    height: float
    use_ocr: bool = True


@router.post("/{file_id}/page/{page_num}/extract", summary="Extract text from a region")
def extract_text(file_id: str, page_num: int, req: ExtractRequest, user: dict = Depends(require_auth)):
    """Extract text from the given relative bounding box on a page."""
    from utils.pdf_processing import extract_text_from_relative_region

    path = _get_path(file_id)
    text = extract_text_from_relative_region(
        path, page_num,
        rel_x=req.x, rel_y=req.y,
        rel_w=req.width, rel_h=req.height,
        use_ocr_fallback=req.use_ocr,
    )
    return {"text": text}


# ---------------------------------------------------------------------------
# Page dimensions
# ---------------------------------------------------------------------------

@router.get("/{file_id}/page/{page_num}/dimensions", summary="Get page dimensions")
def page_dimensions(file_id: str, page_num: int, user: dict = Depends(require_auth)):
    """Return the PDF page size in points."""
    from utils.pdf_processing import get_page_dimensions

    path = _get_path(file_id)
    dims = get_page_dimensions(path, page_num)
    if dims is None:
        raise HTTPException(status_code=404, detail="Page not found.")
    return {"width": dims[0], "height": dims[1]}
