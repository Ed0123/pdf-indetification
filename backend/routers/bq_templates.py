"""BQ Template cloud storage API — stores / retrieves BQ templates from Firestore.

Each BQ template doc lives under ``bq_templates/{template_id}`` and includes:
  - owner_uid: who created it
  - name, boxes (BQ column definitions), permission ("personal" | "public" | "group")
  - group: group name for group-level sharing
  - created_at / updated_at

Routes:
    GET    /api/bq/templates                — list BQ templates visible to current user
    POST   /api/bq/templates                — create a new BQ template
    PUT    /api/bq/templates/{id}           — update an existing BQ template
    DELETE /api/bq/templates/{id}           — delete a BQ template (owner or admin)
"""

import logging
from datetime import datetime, timezone
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from backend.auth_middleware import require_auth
from backend.firebase_setup import get_db

router = APIRouter()
logger = logging.getLogger(__name__)

COLLECTION = "bq_templates"
USERS_COLLECTION = "users"


# ──────────────────────── Models ─────────────────────────────────────────

class BQTemplateBox(BaseModel):
    column_name: str
    x: float
    y: float
    width: float
    height: float
    color: str = "#2980b9"


class BQTemplateCreate(BaseModel):
    name: str
    boxes: List[BQTemplateBox]
    permission: str = "personal"
    group: Optional[str] = None
    preview_file_id: Optional[str] = None
    preview_page: int = 0


class BQTemplateUpdate(BaseModel):
    name: Optional[str] = None
    boxes: Optional[List[BQTemplateBox]] = None
    permission: Optional[str] = None
    group: Optional[str] = None
    preview_file_id: Optional[str] = None
    preview_page: Optional[int] = None


class BQTemplateResponse(BaseModel):
    id: str
    owner_uid: str
    name: str
    boxes: List[BQTemplateBox]
    permission: str
    group: str
    preview_file_id: Optional[str] = None
    preview_page: int = 0
    created_at: str
    updated_at: str


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


# ──────────────────────── CRUD Routes ────────────────────────────────────

@router.get("/")
def list_bq_templates(user: dict = Depends(require_auth)):
    """Return all BQ templates visible to the current user."""
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
def create_bq_template(body: BQTemplateCreate, user: dict = Depends(require_auth)):
    """Create a new cloud BQ template."""
    now = datetime.now(timezone.utc).isoformat()
    uid = user["uid"]
    doc_data = {
        "owner_uid": uid,
        "name": body.name,
        "boxes": [b.model_dump() for b in body.boxes],
        "permission": body.permission,
        "group": body.group or _user_group(uid),
        "preview_file_id": body.preview_file_id,
        "preview_page": body.preview_page,
        "created_at": now,
        "updated_at": now,
    }
    ref = get_db().collection(COLLECTION).document()
    ref.set(doc_data)
    doc_data["id"] = ref.id
    return doc_data


@router.put("/{template_id}")
def update_bq_template(template_id: str, body: BQTemplateUpdate, user: dict = Depends(require_auth)):
    """Update an existing BQ template (owner or admin only)."""
    uid = user["uid"]
    ref = get_db().collection(COLLECTION).document(template_id)
    snap = ref.get()
    if not snap.exists:
        raise HTTPException(404, "BQ Template not found")

    data = snap.to_dict()
    if data["owner_uid"] != uid and not _is_admin(uid):
        raise HTTPException(403, "Not allowed")

    changes: dict = {}
    if body.name is not None:
        changes["name"] = body.name
    if body.boxes is not None:
        changes["boxes"] = [b.model_dump() for b in body.boxes]
    if body.permission is not None:
        changes["permission"] = body.permission
    if body.group is not None:
        changes["group"] = body.group
    if body.preview_file_id is not None:
        changes["preview_file_id"] = body.preview_file_id
    if body.preview_page is not None:
        changes["preview_page"] = body.preview_page
    changes["updated_at"] = datetime.now(timezone.utc).isoformat()

    ref.update(changes)
    updated = ref.get().to_dict()
    updated["id"] = template_id
    return updated


@router.delete("/{template_id}")
def delete_bq_template(template_id: str, user: dict = Depends(require_auth)):
    """Delete a BQ template."""
    uid = user["uid"]
    ref = get_db().collection(COLLECTION).document(template_id)
    snap = ref.get()
    if not snap.exists:
        raise HTTPException(404, "BQ Template not found")

    data = snap.to_dict()
    owner = data.get("owner_uid", uid)
    if owner != uid and not _is_admin(uid):
        raise HTTPException(403, "Not allowed")

    ref.delete()
    return {"deleted": template_id}
