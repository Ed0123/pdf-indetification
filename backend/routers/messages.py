from datetime import datetime, timezone, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from backend.auth_middleware import require_auth
from backend.firebase_setup import get_db
from backend.email_service import notify_admin_new_message, notify_user_reply

router = APIRouter()

MESSAGES_COLLECTION = "messages"


def _message_ref(msg_id: str):
    return get_db().collection(MESSAGES_COLLECTION).document(msg_id)


def _is_admin(uid: str) -> bool:
    snap = get_db().collection("users").document(uid).get()
    if not snap.exists:
        return False
    return snap.to_dict().get("tier") == "admin"


# ──────────────────── Pydantic models ────────────────────────────────────────

class UserMessageCreate(BaseModel):
    message: str


class AdminReply(BaseModel):
    reply: str


class UserMessage(BaseModel):
    id: str
    user_uid: str
    user_email: str
    user_name: str
    body: str
    created_at: str
    reply: Optional[str] = None
    replied_at: Optional[str] = None
    replied_by: Optional[str] = None
    status: Optional[str] = None  # "open" | "closed"


# ──────────────────── Routes ─────────────────────────────────────────────────

@router.post("/users/message")
def create_user_message(body: UserMessageCreate, user: dict = Depends(require_auth)):
    """Allow a logged-in user to send a message to the admin.

    The message is stored in Firestore and triggers an email to the admin.
    """
    uid = user["uid"]
    profile_snap = get_db().collection("users").document(uid).get()
    if not profile_snap.exists:
        raise HTTPException(404, "User profile not found")
    profile = profile_snap.to_dict()

    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "user_uid": uid,
        "user_email": profile.get("email", ""),
        "user_name": profile.get("display_name", ""),
        "body": body.message,
        "created_at": now,
        "status": "open",
    }
    ref = get_db().collection(MESSAGES_COLLECTION).document()
    ref.set(doc)

    # notify admin via email asynchronously
    notify_admin_new_message(doc["user_email"], doc["user_name"], doc["body"])

    return {"id": ref.id, **doc}


@router.get("/users/message")
def list_my_messages(user: dict = Depends(require_auth)):
    """Return messages sent by the current user."""
    uid = user["uid"]
    msgs = (
        get_db()
        .collection(MESSAGES_COLLECTION)
        .where("user_uid", "==", uid)
        .order_by("created_at", direction="DESCENDING")
        .stream()
    )
    result = []
    for d in msgs:
        data = d.to_dict()
        data["id"] = d.id
        result.append(data)
    return result


@router.get("/messages/")
def list_all_messages(user: dict = Depends(require_auth)):
    """Admin: list all user messages."""
    if not _is_admin(user["uid"]):
        raise HTTPException(403, "Admin access required")
    msgs = (
        get_db()
        .collection(MESSAGES_COLLECTION)
        .order_by("created_at", direction="DESCENDING")
        .stream()
    )
    result = []
    for d in msgs:
        data = d.to_dict()
        data["id"] = d.id
        result.append(data)
    return result


@router.put("/messages/{msg_id}/reply")
def admin_reply_message(msg_id: str, body: AdminReply, user: dict = Depends(require_auth)):
    """Admin: reply to a user message and notify them by email."""
    if not _is_admin(user["uid"]):
        raise HTTPException(403, "Admin access required")

    ref = _message_ref(msg_id)
    snap = ref.get()
    if not snap.exists:
        raise HTTPException(404, "Message not found")
    msg = snap.to_dict()

    update = {
        "reply": body.reply,
        "replied_at": datetime.now(timezone.utc).isoformat(),
        "replied_by": user["uid"],
        "status": "closed",
    }
    ref.update(update)

    # send notification email to user
    notify_user_reply(msg.get("user_email", ""), msg.get("user_name", ""), body.reply)

    return {**msg, **update}


@router.delete("/messages/expired")
def delete_expired_messages(user: dict = Depends(require_auth)):
    """Admin: remove messages older than 7 days. Intended for Cloud Scheduler.

    Deletes any message whose created_at timestamp is more than 7 days ago.
    """
    if not _is_admin(user["uid"]):
        raise HTTPException(403, "Admin access required")

    cutoff = datetime.now(timezone.utc) - timedelta(days=7)
    cutoff_iso = cutoff.isoformat()

    deleted_ids = []
    # iterate over every document and check the timestamp manually
    for doc in get_db().collection(MESSAGES_COLLECTION).stream():
        data = doc.to_dict()
        created = data.get("created_at", "")
        if created and created < cutoff_iso:
            get_db().collection(MESSAGES_COLLECTION).document(doc.id).delete()
            deleted_ids.append(doc.id)

    return {"deleted": deleted_ids}
