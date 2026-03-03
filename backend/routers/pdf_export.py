"""
PDF page export router.

POST /api/pdf/export-pages
  Body: { pages: [{ file_id, page_number, filename }] }
  Returns: application/zip  (individual named PDFs inside)

POST /api/pdf/export-annotated
  Body: { pages: [...], annotations: [...] }
  Returns: application/zip  (PDFs with text overlays)
"""
from __future__ import annotations

import io
import zipfile
from typing import List, Optional

import fitz  # PyMuPDF
from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from backend.auth_middleware import require_auth
from .pdf import _STORE  # reuse the in-memory file store

router = APIRouter()


class PageEntry(BaseModel):
    file_id: str
    page_number: int  # 0-based
    filename: str     # desired output filename including .pdf


class ExportRequest(BaseModel):
    pages: List[PageEntry]


class TextAnnotation(BaseModel):
    """A text annotation to draw on a PDF page."""
    file_id: str
    page_number: int          # 0-based
    text: str                 # Text to draw
    x: float                  # X position (absolute PDF coordinates)
    y: float                  # Y position (absolute PDF coordinates)
    font_size: float = 10     # Font size in points
    color: str = "#000000"    # Hex color
    bold: bool = False        # Bold text
    align: str = "left"       # left, center, right


class AnnotatedExportRequest(BaseModel):
    """Request for exporting PDFs with text annotations."""
    pages: List[PageEntry]
    annotations: List[TextAnnotation] = []
    include_annotations: bool = True  # Whether to include the text overlays


def hex_to_rgb(hex_color: str) -> tuple:
    """Convert hex color to RGB tuple (0-1 range)."""
    hex_color = hex_color.lstrip('#')
    r = int(hex_color[0:2], 16) / 255.0
    g = int(hex_color[2:4], 16) / 255.0
    b = int(hex_color[4:6], 16) / 255.0
    return (r, g, b)


@router.post("/export-pages")
async def export_pages(req: ExportRequest, user: dict = Depends(require_auth)) -> StreamingResponse:
    if not req.pages:
        raise HTTPException(status_code=400, detail="No pages specified")

    zip_buffer = io.BytesIO()

    with zipfile.ZipFile(zip_buffer, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
        for entry in req.pages:
            path = _STORE.get(entry.file_id)
            if not path:
                raise HTTPException(
                    status_code=404,
                    detail=f"file_id '{entry.file_id}' not found; re-upload the PDF",
                )

            src = fitz.open(path)
            if entry.page_number < 0 or entry.page_number >= src.page_count:
                src.close()
                raise HTTPException(
                    status_code=400,
                    detail=f"page_number {entry.page_number} out of range for '{entry.filename}'",
                )

            single = fitz.open()
            single.insert_pdf(src, from_page=entry.page_number, to_page=entry.page_number)
            pdf_bytes = single.tobytes()
            single.close()
            src.close()

            # Ensure the filename ends with .pdf
            fname = entry.filename if entry.filename.lower().endswith(".pdf") else entry.filename + ".pdf"
            zf.writestr(fname, pdf_bytes)

    zip_buffer.seek(0)
    return StreamingResponse(
        zip_buffer,
        media_type="application/zip",
        headers={"Content-Disposition": 'attachment; filename="exported_pages.zip"'},
    )


@router.post("/export-annotated")
async def export_annotated(req: AnnotatedExportRequest, user: dict = Depends(require_auth)) -> StreamingResponse:
    """
    Export PDF pages with text annotations overlaid.
    
    Annotations are drawn on the PDF at specified coordinates.
    Can be used to add user-entered values (rate, qty, total) to the PDF.
    """
    if not req.pages:
        raise HTTPException(status_code=400, detail="No pages specified")

    zip_buffer = io.BytesIO()

    # Group annotations by file_id and page_number for efficient access
    annotations_map: dict[str, list[TextAnnotation]] = {}
    for ann in req.annotations:
        key = f"{ann.file_id}-{ann.page_number}"
        if key not in annotations_map:
            annotations_map[key] = []
        annotations_map[key].append(ann)

    with zipfile.ZipFile(zip_buffer, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
        for entry in req.pages:
            path = _STORE.get(entry.file_id)
            if not path:
                raise HTTPException(
                    status_code=404,
                    detail=f"file_id '{entry.file_id}' not found; re-upload the PDF",
                )

            src = fitz.open(path)
            if entry.page_number < 0 or entry.page_number >= src.page_count:
                src.close()
                raise HTTPException(
                    status_code=400,
                    detail=f"page_number {entry.page_number} out of range for '{entry.filename}'",
                )

            # Create a new document with just this page
            single = fitz.open()
            single.insert_pdf(src, from_page=entry.page_number, to_page=entry.page_number)
            
            # Add text annotations if requested
            if req.include_annotations:
                key = f"{entry.file_id}-{entry.page_number}"
                page_annotations = annotations_map.get(key, [])
                
                if page_annotations:
                    page = single[0]  # We only have one page in the single doc
                    
                    for ann in page_annotations:
                        # Convert hex color to RGB
                        color = hex_to_rgb(ann.color)
                        
                        # Create text insertion point
                        # Note: PyMuPDF uses top-left origin, y increases downward
                        point = fitz.Point(ann.x, ann.y)
                        
                        # Select font
                        fontname = "helv"  # Helvetica
                        if ann.bold:
                            fontname = "hebo"  # Helvetica-Bold
                        
                        # Insert text
                        page.insert_text(
                            point,
                            ann.text,
                            fontsize=ann.font_size,
                            fontname=fontname,
                            color=color,
                        )
            
            pdf_bytes = single.tobytes()
            single.close()
            src.close()

            # Ensure the filename ends with .pdf
            fname = entry.filename if entry.filename.lower().endswith(".pdf") else entry.filename + ".pdf"
            zf.writestr(fname, pdf_bytes)

    zip_buffer.seek(0)
    return StreamingResponse(
        zip_buffer,
        media_type="application/zip",
        headers={"Content-Disposition": 'attachment; filename="annotated_pages.zip"'},
    )
