"""User profile & admin API endpoints.

All endpoints require a valid Firebase ID token in the Authorization header.

Routes:
    GET  /api/users/me            — current user profile
    PUT  /api/users/me            — update own profile
    GET  /api/users/              — list all users (admin only)
    PUT  /api/users/{uid}         — admin update any user (status, tier, group, notes)
    POST /api/users/usage/record  — record page usage (internal)
"""

from datetime import datetime, timezone
import os
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from backend.auth_middleware import require_auth
from backend.firebase_setup import get_db

router = APIRouter()
_DEV_MODE = os.getenv("DEV_MODE", "").strip() in ("1", "true", "yes")

# ──────────────────── Pydantic models ────────────────────────────────────────

class ProfileUpdate(BaseModel):
    display_name: Optional[str] = None
    salutation: Optional[str] = None
    email: Optional[str] = None
    whatsapp: Optional[str] = None


class AdminUserUpdate(BaseModel):
    status: Optional[str] = None   # "pending" | "active" | "suspended"
    tier: Optional[str] = None     # "basic" | "sponsor" | "premium" | "admin"
    group: Optional[str] = None
    notes: Optional[str] = None


class UsageRecord(BaseModel):
    pages: int  # number of pages OCR'd in this request


class GroupCreate(BaseModel):
    name: str


class GroupRename(BaseModel):
    name: str


# ──────────────────── Helpers ────────────────────────────────────────────────

USERS_COLLECTION = "users"
TEMPLATES_COLLECTION = "templates"
GROUPS_COLLECTION = "groups"
DEFAULT_GROUPS = ["A組", "B組", "C組"]

def _user_ref(uid: str):
    return get_db().collection(USERS_COLLECTION).document(uid)


def _groups_collection():
    return get_db().collection(GROUPS_COLLECTION)


def _ensure_default_groups() -> list[dict]:
    """Ensure group list exists; bootstrap A/B/C when empty."""
    docs = list(_groups_collection().stream())
    if docs:
        return [{"id": d.id, "name": d.to_dict().get("name", "")} for d in docs]

    created = []
    for group_name in DEFAULT_GROUPS:
        ref = _groups_collection().document()
        ref.set({"name": group_name})
        created.append({"id": ref.id, "name": group_name})
    return created


def _group_names() -> list[str]:
    return [g["name"] for g in _ensure_default_groups()]


def _get_or_create_profile(uid: str, email: str | None = None,
                           display_name: str | None = None,
                           photo_url: str | None = None) -> dict:
    """Return existing profile or create a new *pending* one."""
    ref = _user_ref(uid)
    snap = ref.get()
    if snap.exists:
        return snap.to_dict()

    now = datetime.now(timezone.utc).isoformat()
    default_tier = "admin" if _DEV_MODE else "basic"
    default_status = "active" if _DEV_MODE else "pending"

    groups = _group_names()
    default_group = groups[0] if groups else "A組"

    profile = {
        "uid": uid,
        "email": email or "",
        "display_name": display_name or "",
        "salutation": "",
        "whatsapp": "",
        "tier": default_tier,
        "status": default_status,
        "group": default_group,
        "usage_month": datetime.now(timezone.utc).strftime("%Y-%m"),
        "usage_pages": 0,
        "created_at": now,
        "last_login": now,
        "notes": "",
        "photo_url": photo_url or "",
    }
    ref.set(profile)
    return profile


def _is_admin(uid: str) -> bool:
    snap = _user_ref(uid).get()
    if not snap.exists:
        return False
    return snap.to_dict().get("tier") == "admin"


def _replace_group_name_in_documents(old_name: str, new_name: str):
    """Propagate renamed group name to users and group-permission templates."""
    for doc in get_db().collection(USERS_COLLECTION).stream():
        data = doc.to_dict()
        if data.get("group") == old_name:
            get_db().collection(USERS_COLLECTION).document(doc.id).update({"group": new_name})

    for doc in get_db().collection(TEMPLATES_COLLECTION).stream():
        data = doc.to_dict()
        if data.get("permission") == "group" and data.get("group") == old_name:
            get_db().collection(TEMPLATES_COLLECTION).document(doc.id).update({"group": new_name})


def _reassign_deleted_group_in_documents(deleted_name: str, fallback_name: str):
    """Reassign users/templates pointing to deleted group."""
    for doc in get_db().collection(USERS_COLLECTION).stream():
        data = doc.to_dict()
        if data.get("group") == deleted_name:
            get_db().collection(USERS_COLLECTION).document(doc.id).update({"group": fallback_name})

    for doc in get_db().collection(TEMPLATES_COLLECTION).stream():
        data = doc.to_dict()
        if data.get("permission") == "group" and data.get("group") == deleted_name:
            get_db().collection(TEMPLATES_COLLECTION).document(doc.id).update({"group": fallback_name})


# ──────────────────── Routes ─────────────────────────────────────────────────

@router.get("/me")
def get_my_profile(user: dict = Depends(require_auth)):
    """Return the current user's profile, creating it if first login."""
    profile = _get_or_create_profile(
        uid=user["uid"],
        email=user.get("email"),
        display_name=user.get("name"),
        photo_url=user.get("picture"),
    )
    if _DEV_MODE and (profile.get("status") != "active" or profile.get("tier") != "admin"):
        _user_ref(user["uid"]).update({"status": "active", "tier": "admin"})
        profile["status"] = "active"
        profile["tier"] = "admin"
    # Update last_login
    _user_ref(user["uid"]).update({"last_login": datetime.now(timezone.utc).isoformat()})
    return profile


@router.put("/me")
def update_my_profile(body: ProfileUpdate, user: dict = Depends(require_auth)):
    """Update the current user's own profile fields."""
    changes = {k: v for k, v in body.model_dump().items() if v is not None}
    if not changes:
        raise HTTPException(400, "No fields to update")
    _user_ref(user["uid"]).update(changes)
    return {**_user_ref(user["uid"]).get().to_dict()}


@router.get("/")
def list_all_users(user: dict = Depends(require_auth)):
    """List all users (admin only)."""
    if not _is_admin(user["uid"]):
        raise HTTPException(403, "Admin access required")
    docs = get_db().collection(USERS_COLLECTION).stream()
    return [d.to_dict() for d in docs]


@router.put("/{uid}")
def admin_update_user(uid: str, body: AdminUserUpdate, user: dict = Depends(require_auth)):
    """Admin: update another user's status / tier / group / notes."""
    if not _is_admin(user["uid"]):
        raise HTTPException(403, "Admin access required")

    ref = _user_ref(uid)
    if not ref.get().exists:
        raise HTTPException(404, f"User {uid} not found")

    changes = {k: v for k, v in body.model_dump().items() if v is not None}
    if not changes:
        raise HTTPException(400, "No fields to update")

    ref.update(changes)
    return ref.get().to_dict()


@router.post("/usage/record")
def record_usage(body: UsageRecord, user: dict = Depends(require_auth)):
    """Record OCR page usage for the current user.

    Returns the updated counts and whether the user has hit the limit.
    """
    ref = _user_ref(user["uid"])
    snap = ref.get()
    if not snap.exists:
        raise HTTPException(404, "User profile not found")

    profile = snap.to_dict()
    current_month = datetime.now(timezone.utc).strftime("%Y-%m")

    # Reset counter if new month
    if profile.get("usage_month") != current_month:
        profile["usage_month"] = current_month
        profile["usage_pages"] = 0

    new_count = profile["usage_pages"] + body.pages

    # Tier limits
    tier_limits = {
        "basic": 100,
        "sponsor": 300,
        "premium": 500,
        "admin": float("inf"),
    }
    limit = tier_limits.get(profile.get("tier", "basic"), 100)
    over_limit = new_count > limit

    ref.update({
        "usage_month": current_month,
        "usage_pages": new_count,
    })

    return {
        "usage_pages": new_count,
        "limit": limit if limit != float("inf") else -1,
        "over_limit": over_limit,
    }


@router.post("/{uid}/usage/reset")
def admin_reset_usage(uid: str, user: dict = Depends(require_auth)):
    """Admin: reset a user's monthly usage counter to 0."""
    if not _is_admin(user["uid"]):
        raise HTTPException(403, "Admin access required")

    ref = _user_ref(uid)
    snap = ref.get()
    if not snap.exists:
        raise HTTPException(404, f"User {uid} not found")

    current_month = datetime.now(timezone.utc).strftime("%Y-%m")
    ref.update({
        "usage_month": current_month,
        "usage_pages": 0,
    })
    return ref.get().to_dict()


@router.get("/groups")
def list_groups(user: dict = Depends(require_auth)):
    """List available groups. Bootstraps A/B/C if collection is empty."""
    if not _is_admin(user["uid"]):
        raise HTTPException(403, "Admin access required")
    return _ensure_default_groups()


@router.post("/groups")
def create_group(body: GroupCreate, user: dict = Depends(require_auth)):
    """Admin: create a new group."""
    if not _is_admin(user["uid"]):
        raise HTTPException(403, "Admin access required")

    name = body.name.strip()
    if not name:
        raise HTTPException(400, "Group name is required")

    existing_names = set(_group_names())
    if name in existing_names:
        raise HTTPException(400, "Group name already exists")

    ref = _groups_collection().document()
    ref.set({"name": name})
    return {"id": ref.id, "name": name}


@router.put("/groups/{group_id}")
def rename_group(group_id: str, body: GroupRename, user: dict = Depends(require_auth)):
    """Admin: rename a group and propagate to users/templates."""
    if not _is_admin(user["uid"]):
        raise HTTPException(403, "Admin access required")

    new_name = body.name.strip()
    if not new_name:
        raise HTTPException(400, "Group name is required")

    ref = _groups_collection().document(group_id)
    snap = ref.get()
    if not snap.exists:
        raise HTTPException(404, "Group not found")

    old_name = snap.to_dict().get("name", "")
    if old_name != new_name and new_name in set(_group_names()):
        raise HTTPException(400, "Group name already exists")

    ref.update({"name": new_name})
    if old_name and old_name != new_name:
        _replace_group_name_in_documents(old_name, new_name)
    return {"id": group_id, "name": new_name}


@router.delete("/groups/{group_id}")
def delete_group(group_id: str, user: dict = Depends(require_auth)):
    """Admin: delete a group and reassign affected users/templates."""
    if not _is_admin(user["uid"]):
        raise HTTPException(403, "Admin access required")

    groups = _ensure_default_groups()
    if len(groups) <= 1:
        raise HTTPException(400, "Cannot delete the last remaining group")

    ref = _groups_collection().document(group_id)
    snap = ref.get()
    if not snap.exists:
        raise HTTPException(404, "Group not found")

    deleted_name = snap.to_dict().get("name", "")
    fallback = next((g["name"] for g in groups if g["id"] != group_id), None)
    if not fallback:
        raise HTTPException(400, "No fallback group available")

    ref.delete()
    if deleted_name:
        _reassign_deleted_group_in_documents(deleted_name, fallback)
    return {"deleted": group_id, "fallback_group": fallback}
