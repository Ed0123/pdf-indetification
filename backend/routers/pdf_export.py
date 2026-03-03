"""
PDF page export router.

POST /api/pdf/export-pages
  Body: { pages: [{ file_id, page_number, filename }] }
  Returns: application/zip  (individual named PDFs inside)

POST /api/pdf/export-annotated
  Body: { pages: [...], annotations: [...], merge: true/false }
  Returns: Single merged PDF or ZIP  (PDFs with text overlays)
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
    color: str = "#000000"    # Hex color (used for viewer display)
    bold: bool = False        # Bold text
    align: str = "left"       # left, center, right


class AnnotatedExportRequest(BaseModel):
    """Request for exporting PDFs with text annotations."""
    pages: List[PageEntry]
    annotations: List[TextAnnotation] = []
    include_annotations: bool = True  # Whether to include the text overlays
    merge: bool = True                # Merge all pages into single PDF
    output_filename: str = "annotated.pdf"  # Output filename for merged PDF


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
    Text is always rendered in BLACK for printing/professional use.
    Can merge all pages into a single PDF or export as separate files in ZIP.
    """
    if not req.pages:
        raise HTTPException(status_code=400, detail="No pages specified")

    # Group annotations by file_id and page_number for efficient access
    annotations_map: dict[str, list[TextAnnotation]] = {}
    for ann in req.annotations:
        key = f"{ann.file_id}-{ann.page_number}"
        if key not in annotations_map:
            annotations_map[key] = []
        annotations_map[key].append(ann)

    if req.merge:
        # Merge all pages into a single PDF
        merged_doc = fitz.open()
        
        for entry in req.pages:
            path = _STORE.get(entry.file_id)
            if not path:
                merged_doc.close()
                raise HTTPException(
                    status_code=404,
                    detail=f"file_id '{entry.file_id}' not found; re-upload the PDF",
                )

            src = fitz.open(path)
            if entry.page_number < 0 or entry.page_number >= src.page_count:
                src.close()
                merged_doc.close()
                raise HTTPException(
                    status_code=400,
                    detail=f"page_number {entry.page_number} out of range for '{entry.filename}'",
                )

            # Insert page into merged document
            merged_doc.insert_pdf(src, from_page=entry.page_number, to_page=entry.page_number)
            
            # Add text annotations if requested
            if req.include_annotations:
                key = f"{entry.file_id}-{entry.page_number}"
                page_annotations = annotations_map.get(key, [])
                
                if page_annotations:
                    # Get the last inserted page
                    page = merged_doc[-1]
                    
                    for ann in page_annotations:
                        # Always use BLACK for PDF export (ignore annotation color)
                        color = (0, 0, 0)  # Black
                        
                        point = fitz.Point(ann.x, ann.y)
                        fontname = "helv"
                        if ann.bold:
                            fontname = "hebo"
                        
                        page.insert_text(
                            point,
                            ann.text,
                            fontsize=ann.font_size,
                            fontname=fontname,
                            color=color,
                        )
            
            src.close()
        
        pdf_buffer = io.BytesIO(merged_doc.tobytes())
        merged_doc.close()
        
        output_filename = req.output_filename
        if not output_filename.lower().endswith(".pdf"):
            output_filename += ".pdf"
        
        return StreamingResponse(
            pdf_buffer,
            media_type="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="{output_filename}"'},
        )
    else:
        # Export as separate files in ZIP (original behavior)
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
                
                if req.include_annotations:
                    key = f"{entry.file_id}-{entry.page_number}"
                    page_annotations = annotations_map.get(key, [])
                    
                    if page_annotations:
                        page = single[0]
                        
                        for ann in page_annotations:
                            color = (0, 0, 0)  # Black
                            point = fitz.Point(ann.x, ann.y)
                            fontname = "helv"
                            if ann.bold:
                                fontname = "hebo"
                            
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

                fname = entry.filename if entry.filename.lower().endswith(".pdf") else entry.filename + ".pdf"
                zf.writestr(fname, pdf_bytes)

        zip_buffer.seek(0)
        return StreamingResponse(
            zip_buffer,
            media_type="application/zip",
            headers={"Content-Disposition": 'attachment; filename="annotated_pages.zip"'},
        )
