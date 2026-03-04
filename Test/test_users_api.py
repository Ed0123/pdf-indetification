import pytest
from datetime import datetime, timezone, timedelta

from backend.routers import users as users_router


def make_doc(data):
    class Doc:
        def __init__(self, data):
            self._data = data
            self.reference = self

        def to_dict(self):
            # return a shallow copy so callers can't mutate internals
            return dict(self._data)

        def update(self, changes):
            self._data.update(changes)

    return Doc(data)


def test_list_all_users_resets_month(monkeypatch):
    # prepare two user docs: one with old month, one current
    now = datetime.now(timezone.utc)
    old_month = (now - timedelta(days=40)).strftime("%Y-%m")
    curr_month = now.strftime("%Y-%m")

    doc1 = make_doc({"uid": "u1", "usage_month": old_month, "usage_pages": 123})
    doc2 = make_doc({"uid": "u2", "usage_month": curr_month, "usage_pages": 5})

    class DummyColl:
        def __init__(self, docs):
            self._docs = docs

        def stream(self):
            return self._docs

    class DummyDB:
        def __init__(self, docs):
            self._coll = DummyColl(docs)

        def collection(self, name):
            assert name == users_router.USERS_COLLECTION
            return self._coll

    dummy_db = DummyDB([doc1, doc2])

    monkeypatch.setattr(users_router, "get_db", lambda: dummy_db)
    monkeypatch.setattr(users_router, "_is_admin", lambda uid: True)

    result = users_router.list_all_users(user={"uid": "admin"})
    # doc1 should have been reset to current month and pages 0
    assert any(u["uid"] == "u1" and u["usage_month"] == curr_month and u["usage_pages"] == 0 for u in result)
    # underlying object updated as well
    assert doc1._data["usage_month"] == curr_month
    assert doc1._data["usage_pages"] == 0
    # doc2 unchanged
    assert any(u["uid"] == "u2" and u["usage_month"] == curr_month and u["usage_pages"] == 5 for u in result)

    # non-admin should be rejected
    monkeypatch.setattr(users_router, "_is_admin", lambda uid: False)
    with pytest.raises(Exception):
        users_router.list_all_users(user={"uid": "u1"})
