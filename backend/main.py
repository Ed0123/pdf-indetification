"""FastAPI backend for PDF Text Extraction web application.

Run locally:
    uvicorn backend.main:app --reload --port 8000

Deploy to Cloud Run:
    gcloud run deploy pdf-backend --source backend/ --region asia-east1
"""

import os
import sys
from pathlib import Path

# Allow importing from project root (models/, utils/)
sys.path.insert(0, str(Path(__file__).parent.parent))

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

from backend.routers import pdf as pdf_router
from backend.routers import project as project_router
from backend.routers import export as export_router
from backend.routers import pdf_export as pdf_export_router
from backend.routers import users as users_router
from backend.routers import templates as templates_router
from backend.routers import cloud_projects as cloud_projects_router
from backend.firebase_setup import init_firebase

app = FastAPI(
    title="PDF Text Extraction API",
    version="1.0.0",
    description="Backend API for PDF text extraction web application.",
)

# Allow all origins for Firebase Hosting + local dev.
# Tighten this in production to your Firebase Hosting URL.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(pdf_router.router, prefix="/api/pdf", tags=["PDF"])
app.include_router(project_router.router, prefix="/api/project", tags=["Project"])
app.include_router(export_router.router, prefix="/api/export", tags=["Export"])
app.include_router(pdf_export_router.router, prefix="/api/pdf", tags=["PDF Export"])
app.include_router(users_router.router, prefix="/api/users", tags=["Users"])
app.include_router(templates_router.router, prefix="/api/templates", tags=["Templates"])
app.include_router(cloud_projects_router.router, prefix="/api/projects/cloud", tags=["Cloud Projects"])


@app.on_event("startup")
def startup():
    """Initialise Firebase Admin SDK (if credentials are available)."""
    try:
        init_firebase()
    except Exception as exc:
        # Non-fatal: auth endpoints will fail but the rest of the API works
        import logging
        logging.warning("Firebase Admin init skipped: %s", exc)


@app.get("/api/health", tags=["Health"])
def health_check():
    """Simple liveness probe used by Cloud Run."""
    return {"status": "ok"}


@app.get("/api/ocr/status", tags=["OCR"])
def ocr_status():
    """Return whether Tesseract OCR is available in this deployment."""
    from utils.pdf_processing import is_ocr_available
    return {"available": is_ocr_available()}


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("backend.main:app", host="0.0.0.0", port=port, reload=False)
