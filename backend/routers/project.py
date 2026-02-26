"""Project router – save and load project state as JSON."""

import io
import json
from fastapi import APIRouter, UploadFile, File, HTTPException, Depends, Request
from fastapi.responses import StreamingResponse

from backend.auth_middleware import require_auth

router = APIRouter()

# Max project JSON payload: 50 MB
MAX_PROJECT_SIZE = 50 * 1024 * 1024


@router.post("/save", summary="Download project as JSON")
async def save_project(request: Request, user: dict = Depends(require_auth)):
    """
    Accept the full project state from the frontend and return it
    as a downloadable JSON file.
    """
    body = await request.body()
    if len(body) > MAX_PROJECT_SIZE:
        raise HTTPException(413, f"Project too large (max {MAX_PROJECT_SIZE // (1024*1024)} MB)")
    try:
        payload = json.loads(body)
    except json.JSONDecodeError as exc:
        raise HTTPException(422, f"Invalid JSON: {exc}")
    content = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
    return StreamingResponse(
        io.BytesIO(content),
        media_type="application/json",
        headers={"Content-Disposition": 'attachment; filename="project.json"'},
    )


@router.post("/load", summary="Upload a saved project JSON")
async def load_project(file: UploadFile = File(...), user: dict = Depends(require_auth)):
    """Parse and return a previously saved project.json."""
    if not file.filename or not file.filename.lower().endswith(".json"):
        raise HTTPException(status_code=422, detail="Please upload a .json file.")

    content = await file.read()
    if len(content) > MAX_PROJECT_SIZE:
        raise HTTPException(413, f"Project file too large (max {MAX_PROJECT_SIZE // (1024*1024)} MB)")
    try:
        data = json.loads(content.decode("utf-8"))
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=422, detail=f"Invalid JSON: {exc}")

    return data
