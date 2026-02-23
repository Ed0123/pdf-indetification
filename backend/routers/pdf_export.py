"""
PDF page export router.

POST /api/pdf/export-pages
  Body: { pages: [{ file_id, page_number, filename }] }
  Returns: application/zip  (individual named PDFs inside)
"""
from __future__ import annotations

import io
import zipfile
from typing import List

import fitz  # PyMuPDF
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from .pdf import _STORE  # reuse the in-memory file store

router = APIRouter()


class PageEntry(BaseModel):
    file_id: str
    page_number: int  # 0-based
    filename: str     # desired output filename including .pdf


class ExportRequest(BaseModel):
    pages: List[PageEntry]


@router.post("/export-pages")
async def export_pages(req: ExportRequest) -> StreamingResponse:
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
