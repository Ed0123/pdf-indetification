from datetime import datetime, timezone, timedelta

import pytest

from backend.routers import messages as msg_router
from backend import email_service
from backend.routers.users import _get_or_create_profile
from backend.firebase_setup import get_db


class DummyUser:
    def __init__(self, uid, email, display_name):
        self.uid = uid
        self.email = email
        self.display_name = display_name


@pytest.fixture(autouse=True)
def clear_firestore(monkeypatch):
    # ensure fake Firestore is fresh for each test
    get_db().collections = {}
    yield


def test_user_can_create_message(monkeypatch):
    # prepare user profile
    uid = "user123"
    _get_or_create_profile(uid=uid, email="a@b.com", display_name="Alice")

    sent = []
    monkeypatch.setattr(email_service, "_send_email", lambda to, subj, html: sent.append((to, subj)) or True)

    body = msg_router.UserMessageCreate(message="Hello admin")
    user = {"uid": uid}
    result = msg_router.create_user_message(body, user)

    assert result["user_uid"] == uid
    assert result["body"] == "Hello admin"
    assert sent, "Admin should have been emailed"


def test_admin_can_reply(monkeypatch):
    # prepare user and message
    uid = "user456"
    _get_or_create_profile(uid=uid, email="x@y.com", display_name="Bob")
    body = msg_router.UserMessageCreate(message="Need help")
    user = {"uid": uid}
    created = msg_router.create_user_message(body, user)

    admin_sent = []
    user_sent = []
    monkeypatch.setattr(email_service, "_send_email", lambda to, subj, html: user_sent.append((to, subj)) or True)

    admin = {"uid": uid, "is_admin": True}
    # monkeypatch _is_admin to treat anybody as admin for simplicity
    monkeypatch.setattr(msg_router, "_is_admin", lambda u: True)

    reply_body = msg_router.AdminReply(reply="Here is a reply")
    updated = msg_router.admin_reply_message(created["id"], reply_body, admin)

    assert updated["reply"] == "Here is a reply"
    assert user_sent, "User should have been emailed a reply"


def test_delete_expired(monkeypatch):
    # prepare two messages, one old (>7d) and one recent
    uid = "user789"
    _get_or_create_profile(uid=uid, email="e@f.com", display_name="Carol")
    body = msg_router.UserMessageCreate(message="old message")
    user = {"uid": uid}
    old = msg_router.create_user_message(body, user)
    # manually rewrite created_at to 10 days ago
    ten_days_ago = (datetime.now(timezone.utc) - timedelta(days=10)).isoformat()
    get_db().collection(msg_router.MESSAGES_COLLECTION).document(old["id"]).update({"created_at": ten_days_ago})
    recent_body = msg_router.UserMessageCreate(message="recent")
    recent = msg_router.create_user_message(recent_body, user)

    # monkeypatch admin check
    monkeypatch.setattr(msg_router, "_is_admin", lambda u: True)
    admin = {"uid": "admin1"}

    result = msg_router.delete_expired_messages(admin)
    assert old["id"] in result["deleted"]
    assert recent["id"] not in result["deleted"]
