"""Project router – save and load project state as JSON."""

import io
import json
from fastapi import APIRouter, UploadFile, File, HTTPException
from fastapi.responses import StreamingResponse

router = APIRouter()


@router.post("/save", summary="Download project as JSON")
def save_project(payload: dict):
    """
    Accept the full project state from the frontend and return it
    as a downloadable JSON file.
    """
    content = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
    return StreamingResponse(
        io.BytesIO(content),
        media_type="application/json",
        headers={"Content-Disposition": 'attachment; filename="project.json"'},
    )


@router.post("/load", summary="Upload a saved project JSON")
async def load_project(file: UploadFile = File(...)):
    """Parse and return a previously saved project.json."""
    if not file.filename or not file.filename.lower().endswith(".json"):
        raise HTTPException(status_code=422, detail="Please upload a .json file.")

    content = await file.read()
    try:
        data = json.loads(content.decode("utf-8"))
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=422, detail=f"Invalid JSON: {exc}")

    return data
