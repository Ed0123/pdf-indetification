"""Export router – generate and return an Excel file."""

import io
import os
import sys
import tempfile
from pathlib import Path

from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Any, Dict, List, Optional

from backend.auth_middleware import require_auth

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

router = APIRouter()


@router.post("/excel", summary="Export project data to Excel")
def export_excel(payload: dict, user: dict = Depends(require_auth)):
    """
    Accept the full project state, rebuild data model objects,
    and return an Excel workbook as a file download.
    """
    from models.data_models import ProjectData
    from utils.excel_export import export_to_excel

    try:
        project = ProjectData.from_dict(payload)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Invalid project data: {exc}")

    with tempfile.NamedTemporaryFile(suffix=".xlsx", delete=False) as tmp:
        tmp_path = tmp.name

    try:
        export_to_excel(project, tmp_path)
        with open(tmp_path, "rb") as f:
            content = f.read()
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)

    return StreamingResponse(
        io.BytesIO(content),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="export.xlsx"'},
    )
