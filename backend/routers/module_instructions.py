"""Module instruction endpoints.

Stores per-module HTML instructions that admins can edit and all users can view.
Each module (e.g. "bq_export", "pdf_unlock") has one document in the
``module_instructions`` Firestore collection.

Routes:
    GET  /api/module-instructions/           — list all instructions
    GET  /api/module-instructions/{module_id} — get one module's instruction
    PUT  /api/module-instructions/{module_id} — update (admin only)
"""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from backend.auth_middleware import require_auth
from backend.firebase_setup import get_db

router = APIRouter()
COLLECTION = "module_instructions"
USERS_COLLECTION = "users"


class InstructionUpdate(BaseModel):
    content_html: str  # HTML content for the instruction


def _is_admin(uid: str) -> bool:
    snap = get_db().collection(USERS_COLLECTION).document(uid).get()
    if not snap.exists:
        return False
    return snap.to_dict().get("tier") == "admin"


def _to_item(doc) -> dict:
    d = doc.to_dict() or {}
    d["module_id"] = doc.id
    return d


@router.get("/")
def list_instructions(user: dict = Depends(require_auth)):
    """Return all module instructions as a list."""
    docs = list(get_db().collection(COLLECTION).stream())
    return [_to_item(d) for d in docs]


@router.get("/{module_id}")
def get_instruction(module_id: str, user: dict = Depends(require_auth)):
    """Return instruction for a specific module."""
    ref = get_db().collection(COLLECTION).document(module_id)
    snap = ref.get()
    if not snap.exists:
        return {"module_id": module_id, "content_html": ""}
    return _to_item(snap)


@router.put("/{module_id}")
def update_instruction(module_id: str, body: InstructionUpdate, user: dict = Depends(require_auth)):
    """Create or update instruction for a module (admin only)."""
    if not _is_admin(user["uid"]):
        raise HTTPException(403, "Admin access required")

    ref = get_db().collection(COLLECTION).document(module_id)
    data = {
        "content_html": body.content_html,
        "updated_by": user["uid"],
    }
    ref.set(data, merge=True)
    return {"module_id": module_id, **data}
