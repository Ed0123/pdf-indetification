"""System update feed endpoints.

Provides a lightweight changelog feed for HomePanel and supports:
- admin CRUD updates
- deploy-script push via shared token
"""

from datetime import datetime, timezone
import os

from fastapi import APIRouter, Depends, HTTPException, Header
from pydantic import BaseModel

from backend.auth_middleware import require_auth
from backend.firebase_setup import get_db

router = APIRouter()
COLLECTION = "system_updates"
USERS_COLLECTION = "users"
MAX_ITEMS = 50


class UpdateCreate(BaseModel):
    heading: str
    content: str


class DeployPush(BaseModel):
    heading: str = "系統更新"
    content: str


def _is_admin(uid: str) -> bool:
    snap = get_db().collection(USERS_COLLECTION).document(uid).get()
    if not snap.exists:
        return False
    return snap.to_dict().get("tier") == "admin"


def _to_item(doc):
    d = doc.to_dict()
    d["id"] = doc.id
    return d


@router.get("/")
def list_updates(user: dict = Depends(require_auth)):
    docs = list(get_db().collection(COLLECTION).stream())
    items = [_to_item(d) for d in docs]
    items.sort(key=lambda x: x.get("created_at", ""), reverse=True)
    return items[:MAX_ITEMS]


@router.post("/")
def create_update(body: UpdateCreate, user: dict = Depends(require_auth)):
    if not _is_admin(user["uid"]):
        raise HTTPException(403, "Admin access required")

    heading = body.heading.strip() or "系統更新"
    content = body.content.strip()
    if not content:
        raise HTTPException(400, "content is required")

    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "heading": heading,
        "content": content,
        "created_at": now,
        "created_by": user["uid"],
        "source": "admin",
    }
    ref = get_db().collection(COLLECTION).document()
    ref.set(doc)

    # Keep collection compact: remove oldest extras.
    docs = list(get_db().collection(COLLECTION).stream())
    items = [_to_item(d) for d in docs]
    items.sort(key=lambda x: x.get("created_at", ""), reverse=True)
    for old in items[MAX_ITEMS:]:
        get_db().collection(COLLECTION).document(old["id"]).delete()

    return {"id": ref.id, **doc}


@router.post("/deploy-push")
def deploy_push(
    body: DeployPush,
    x_deploy_token: str | None = Header(default=None),
):
    expected = os.getenv("DEPLOY_UPDATE_TOKEN", "").strip()
    if not expected:
        raise HTTPException(503, "DEPLOY_UPDATE_TOKEN not configured")
    if not x_deploy_token or x_deploy_token != expected:
        raise HTTPException(401, "Invalid deploy token")

    heading = body.heading.strip() or "系統更新"
    content = body.content.strip()
    if not content:
        raise HTTPException(400, "content is required")

    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "heading": heading,
        "content": content,
        "created_at": now,
        "created_by": "deploy",
        "source": "deploy",
    }
    ref = get_db().collection(COLLECTION).document()
    ref.set(doc)

    docs = list(get_db().collection(COLLECTION).stream())
    items = [_to_item(d) for d in docs]
    items.sort(key=lambda x: x.get("created_at", ""), reverse=True)
    for old in items[MAX_ITEMS:]:
        get_db().collection(COLLECTION).document(old["id"]).delete()

    return {"id": ref.id, **doc}


class UpdateEdit(BaseModel):
    heading: str | None = None
    content: str | None = None


@router.put("/{update_id}")
def edit_update(update_id: str, body: UpdateEdit, user: dict = Depends(require_auth)):
    if not _is_admin(user["uid"]):
        raise HTTPException(403, "Admin access required")

    ref = get_db().collection(COLLECTION).document(update_id)
    snap = ref.get()
    if not snap.exists:
        raise HTTPException(404, "Update not found")

    changes: dict = {}
    if body.heading is not None:
        h = body.heading.strip()
        if h:
            changes["heading"] = h
    if body.content is not None:
        c = body.content.strip()
        if c:
            changes["content"] = c

    if not changes:
        raise HTTPException(400, "No valid fields to update")

    ref.update(changes)
    updated = snap.to_dict()
    updated.update(changes)
    updated["id"] = update_id
    return updated


@router.delete("/{update_id}")
def delete_update(update_id: str, user: dict = Depends(require_auth)):
    if not _is_admin(user["uid"]):
        raise HTTPException(403, "Admin access required")

    ref = get_db().collection(COLLECTION).document(update_id)
    if not ref.get().exists:
        raise HTTPException(404, "Update not found")
    ref.delete()
    return {"deleted": update_id}
