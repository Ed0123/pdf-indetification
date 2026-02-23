"""Template cloud storage API — stores / retrieves templates from Firestore.

Each template doc lives under ``templates/{template_id}`` and includes:
  - owner_uid: who created it
  - name, boxes, permission ("personal" | "public" | "group")
  - preview_image: base64 thumbnail (optional)
  - group: group name for group-level sharing
  - created_at / updated_at

Routes:
    GET    /api/templates/          — list templates visible to current user
    POST   /api/templates/          — create a new template
    PUT    /api/templates/{id}      — update an existing template
    DELETE /api/templates/{id}      — delete a template (owner or admin)
"""

from datetime import datetime, timezone
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from backend.auth_middleware import require_auth
from backend.firebase_setup import get_db

router = APIRouter()

COLLECTION = "templates"
USERS_COLLECTION = "users"


# ──────────────────── Models ─────────────────────────────────────────────────

class TemplateBox(BaseModel):
    column_name: str
    x: float
    y: float
    width: float
    height: float


class TemplateCreate(BaseModel):
    name: str
    boxes: List[TemplateBox]
    permission: str = "personal"          # "personal" | "public" | "group"
    preview_image: Optional[str] = None   # base64 PNG
    group: Optional[str] = None


class TemplateUpdate(BaseModel):
    name: Optional[str] = None
    boxes: Optional[List[TemplateBox]] = None
    permission: Optional[str] = None
    preview_image: Optional[str] = None
    group: Optional[str] = None


# ──────────────────── Helpers ────────────────────────────────────────────────

def _user_group(uid: str) -> str:
    ref = get_db().collection(USERS_COLLECTION).document(uid)
    snap = ref.get()
    if snap.exists:
        return snap.to_dict().get("group", "A組")
    return "A組"


def _is_admin(uid: str) -> bool:
    snap = get_db().collection(USERS_COLLECTION).document(uid).get()
    return snap.exists and snap.to_dict().get("tier") == "admin"


# ──────────────────── Routes ─────────────────────────────────────────────────

@router.get("/")
def list_templates(user: dict = Depends(require_auth)):
    """Return all templates visible to the current user.

    Visibility rules:
      - All templates owned by the user
      - All templates with permission="public"
      - All templates with permission="group" whose group matches the user's group
      - Admins see everything
    """
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
        "permission": body.permission,
        "preview_image": body.preview_image or "",
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
    """Delete a template (owner or admin only)."""
    uid = user["uid"]
    ref = get_db().collection(COLLECTION).document(template_id)
    snap = ref.get()
    if not snap.exists:
        raise HTTPException(404, "Template not found")

    data = snap.to_dict()
    if data["owner_uid"] != uid and not _is_admin(uid):
        raise HTTPException(403, "Not allowed")

    ref.delete()
    return {"deleted": template_id}
