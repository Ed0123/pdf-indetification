"""Template cloud storage API — stores / retrieves templates from Firestore + Cloud Storage.

Each template doc lives under ``templates/{template_id}`` and includes:
  - owner_uid: who created it
  - name, notes, boxes, permission ("personal" | "public" | "group")
  - page_image_path: Cloud Storage path to the single PDF page PNG
  - group: group name for group-level sharing
  - created_at / updated_at

Routes:
    GET    /api/templates/                       — list templates visible to current user
    POST   /api/templates/                       — create a new template
    PUT    /api/templates/{id}                   — update an existing template
    DELETE /api/templates/{id}                   — delete a template (owner or admin)
    POST   /api/templates/{id}/page-image-b64    — upload the page PNG as base64 JSON
    GET    /api/templates/{id}/page-image         — get a signed URL / inline base64 for page PNG
"""

import base64
import logging
from datetime import datetime, timezone
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from pydantic import BaseModel

from backend.auth_middleware import require_auth
from backend.firebase_setup import get_db, get_storage_bucket

router = APIRouter()
logger = logging.getLogger(__name__)

COLLECTION = "templates"
USERS_COLLECTION = "users"
STORAGE_PREFIX = "templates"  # gs://<bucket>/templates/<uid>/<template_id>/page.png


# ──────────────────────── Models ─────────────────────────────────────────

class TemplateBox(BaseModel):
    column_name: str
    x: float
    y: float
    width: float
    height: float
    color: str = "#2980b9"


class TemplateCreate(BaseModel):
    name: str
    boxes: List[TemplateBox]
    notes: str = ""
    permission: str = "personal"
    preview_image: Optional[str] = None   # base64 PNG — backward compat
    group: Optional[str] = None


class TemplateUpdate(BaseModel):
    name: Optional[str] = None
    boxes: Optional[List[TemplateBox]] = None
    notes: Optional[str] = None
    permission: Optional[str] = None
    preview_image: Optional[str] = None
    group: Optional[str] = None


class _PageImageBase64Body(BaseModel):
    image: str  # base64-encoded PNG


# ──────────────────────── Helpers ────────────────────────────────────────

def _user_group(uid: str) -> str:
    ref = get_db().collection(USERS_COLLECTION).document(uid)
    snap = ref.get()
    if snap.exists:
        return snap.to_dict().get("group", "General")
    return "General"


def _is_admin(uid: str) -> bool:
    snap = get_db().collection(USERS_COLLECTION).document(uid).get()
    return snap.exists and snap.to_dict().get("tier") == "admin"


def _storage_path(uid: str, template_id: str) -> str:
    return f"{STORAGE_PREFIX}/{uid}/{template_id}/page.png"


def _delete_page_image(uid: str, template_id: str) -> None:
    bucket = get_storage_bucket()
    if bucket is None:
        return
    try:
        blob = bucket.blob(_storage_path(uid, template_id))
        blob.delete()
    except Exception as exc:
        logger.warning("Failed to delete page image for template %s: %s", template_id, exc)


# ──────────────────────── CRUD Routes ────────────────────────────────────

@router.get("/")
def list_templates(user: dict = Depends(require_auth)):
    """Return all templates visible to the current user."""
    uid = user["uid"]
    admin = _is_admin(uid)
    group = _user_group(uid)

    docs = get_db().collection(COLLECTION).stream()
    result = []
    for doc in docs:
        d = doc.to_dict()
        d["id"] = doc.id
        if admin:
            result.append(d)
            continue
        if d.get("owner_uid") == uid:
            result.append(d)
            continue
        perm = d.get("permission", "personal")
        if perm == "public":
            result.append(d)
        elif perm == "group" and d.get("group") == group:
            result.append(d)
    return result


@router.post("/")
def create_template(body: TemplateCreate, user: dict = Depends(require_auth)):
    """Create a new cloud template."""
    now = datetime.now(timezone.utc).isoformat()
    uid = user["uid"]
    doc_data = {
        "owner_uid": uid,
        "name": body.name,
        "boxes": [b.model_dump() for b in body.boxes],
        "notes": body.notes,
        "permission": body.permission,
        "preview_image": body.preview_image or "",
        "page_image_path": "",
        "group": body.group or _user_group(uid),
        "created_at": now,
        "updated_at": now,
    }
    ref = get_db().collection(COLLECTION).document()
    ref.set(doc_data)
    doc_data["id"] = ref.id
    return doc_data


@router.put("/{template_id}")
def update_template(template_id: str, body: TemplateUpdate, user: dict = Depends(require_auth)):
    """Update an existing template (owner or admin only)."""
    uid = user["uid"]
    ref = get_db().collection(COLLECTION).document(template_id)
    snap = ref.get()
    if not snap.exists:
        raise HTTPException(404, "Template not found")

    data = snap.to_dict()
    if data["owner_uid"] != uid and not _is_admin(uid):
        raise HTTPException(403, "Not allowed")

    changes: dict = {}
    if body.name is not None:
        changes["name"] = body.name
    if body.boxes is not None:
        changes["boxes"] = [b.model_dump() for b in body.boxes]
    if body.notes is not None:
        changes["notes"] = body.notes
    if body.permission is not None:
        changes["permission"] = body.permission
    if body.preview_image is not None:
        changes["preview_image"] = body.preview_image
    if body.group is not None:
        changes["group"] = body.group
    changes["updated_at"] = datetime.now(timezone.utc).isoformat()

    ref.update(changes)
    updated = ref.get().to_dict()
    updated["id"] = template_id
    return updated


@router.delete("/{template_id}")
def delete_template(template_id: str, user: dict = Depends(require_auth)):
    """Delete a template + its page image in Cloud Storage."""
    uid = user["uid"]
    ref = get_db().collection(COLLECTION).document(template_id)
    snap = ref.get()
    if not snap.exists:
        raise HTTPException(404, "Template not found")

    data = snap.to_dict()
    owner = data.get("owner_uid", uid)
    if owner != uid and not _is_admin(uid):
        raise HTTPException(403, "Not allowed")

    _delete_page_image(owner, template_id)
    ref.delete()
    return {"deleted": template_id}


# ──────────────────────── Page-image endpoints ───────────────────────────

@router.post("/{template_id}/page-image")
async def upload_page_image(
    template_id: str,
    file: UploadFile = File(...),
    user: dict = Depends(require_auth),
):
    """Upload the single PDF page image (PNG) via multipart form."""
    uid = user["uid"]
    ref = get_db().collection(COLLECTION).document(template_id)
    snap = ref.get()
    if not snap.exists:
        raise HTTPException(404, "Template not found")

    data = snap.to_dict()
    if data.get("owner_uid") != uid and not _is_admin(uid):
        raise HTTPException(403, "Not allowed")

    bucket = get_storage_bucket()
    if bucket is None:
        raise HTTPException(501, "Cloud Storage not configured")

    content = await file.read()
    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(413, "Page image too large (max 10 MB)")

    path = _storage_path(uid, template_id)
    blob = bucket.blob(path)
    blob.upload_from_string(content, content_type=file.content_type or "image/png")

    ref.update({
        "page_image_path": path,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    })
    return {"path": path, "template_id": template_id}


@router.post("/{template_id}/page-image-b64")
def upload_page_image_b64(
    template_id: str,
    body: _PageImageBase64Body,
    user: dict = Depends(require_auth),
):
    """Upload page image as base64 JSON — easier from frontend fetch()."""
    uid = user["uid"]
    ref = get_db().collection(COLLECTION).document(template_id)
    snap = ref.get()
    if not snap.exists:
        raise HTTPException(404, "Template not found")

    data = snap.to_dict()
    if data.get("owner_uid") != uid and not _is_admin(uid):
        raise HTTPException(403, "Not allowed")

    bucket = get_storage_bucket()
    if bucket is None:
        raise HTTPException(501, "Cloud Storage not configured")

    try:
        raw = base64.b64decode(body.image)
    except Exception:
        raise HTTPException(400, "Invalid base64 image data")

    if len(raw) > 10 * 1024 * 1024:
        raise HTTPException(413, "Page image too large (max 10 MB)")

    path = _storage_path(uid, template_id)
    blob = bucket.blob(path)
    blob.upload_from_string(raw, content_type="image/png")

    ref.update({
        "page_image_path": path,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    })
    return {"path": path, "template_id": template_id}


@router.get("/{template_id}/page-image")
def get_page_image(template_id: str, user: dict = Depends(require_auth)):
    """Return a signed URL (or inline base64 fallback) for the page image."""
    uid = user["uid"]
    ref = get_db().collection(COLLECTION).document(template_id)
    snap = ref.get()
    if not snap.exists:
        raise HTTPException(404, "Template not found")

    data = snap.to_dict()
    owner = data.get("owner_uid")
    if owner != uid and not _is_admin(uid):
        perm = data.get("permission", "personal")
        group = _user_group(uid)
        if perm == "personal":
            raise HTTPException(403, "Not allowed")
        if perm == "group" and data.get("group") != group:
            raise HTTPException(403, "Not allowed")

    # Try Cloud Storage — download and return inline base64
    path = data.get("page_image_path", "")
    bucket = get_storage_bucket()
    if bucket and path:
        blob = bucket.blob(path)
        try:
            if blob.exists():
                raw = blob.download_as_bytes()
                b64 = base64.b64encode(raw).decode()
                return {"url": f"data:image/png;base64,{b64}", "source": "storage"}
        except Exception as exc:
            logger.warning("Cloud Storage download failed: %s", exc)

    # Fallback: inline preview_image
    preview = data.get("preview_image", "")
    if preview:
        return {"url": f"data:image/png;base64,{preview}", "source": "inline"}

    return {"url": "", "source": "none"}
