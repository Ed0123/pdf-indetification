import base64
import pytest

from backend.routers import bq_templates as bq_router


def make_doc(data, _id="tmpl1"):
    """Create a mock Firestore snapshot object."""
    class DocSnap:
        def __init__(self, data, id):
            self._data = data
            self.id = id
            self.exists = True

        def to_dict(self):
            return dict(self._data)

    return DocSnap(data, _id)


class _DocRef:
    """Mock Firestore document reference wrapping a snapshot."""
    def __init__(self, snap):
        self._snap = snap

    def get(self):
        return self._snap

    def update(self, changes):
        self._snap._data.update(changes)


class DummyColl:
    def __init__(self, docs):
        # docs: dict id->DocSnap
        self._docs = docs

    def stream(self):
        return list(self._docs.values())

    def document(self, tid):
        if tid in self._docs:
            return _DocRef(self._docs[tid])

        class EmptySnap:
            exists = False
            id = tid
            def to_dict(self):
                return {}

        class EmptyRef:
            def get(self):
                return EmptySnap()
            def update(self, changes):
                pass

        return EmptyRef()


class DummyDB:
    def __init__(self, docs):
        self._coll = DummyColl(docs)

    def collection(self, name):
        assert name == bq_router.COLLECTION
        return self._coll


class DummyBlob:
    def __init__(self, store, path):
        self.store = store
        self.path = path

    def upload_from_string(self, content, content_type=None):
        self.store[self.path] = content

    def download_as_bytes(self):
        return self.store.get(self.path, b"")

    def exists(self):
        return self.path in self.store

    def delete(self):
        self.store.pop(self.path, None)


class DummyBucket:
    def __init__(self, store):
        self.store = store

    def blob(self, path):
        return DummyBlob(self.store, path)


@pytest.fixture(autouse=True)
def patch_auth(monkeypatch):
    # bypass authentication for all tests
    monkeypatch.setattr(bq_router, "_is_admin", lambda uid: True)
    return None


def test_get_bq_page_image_empty(monkeypatch):
    # no page image path stored -> should return none
    doc = make_doc({
        "owner_uid": "u1",
        "name": "foo",
        "boxes": [],
        "permission": "personal",
        "group": "General",
        "preview_file_id": None,
        "preview_page": 0,
        "page_image_path": "",
    }, _id="tmpl1")
    dummy_db = DummyDB({"tmpl1": doc})
    monkeypatch.setattr(bq_router, "get_db", lambda: dummy_db)

    res = bq_router.get_bq_page_image("tmpl1", user={"uid": "u1"})
    assert res["url"] == ""
    assert res["source"] == "none"


def test_upload_and_fetch_bq_page_image(monkeypatch):
    doc = make_doc({
        "owner_uid": "u1",
        "name": "foo",
        "boxes": [],
        "permission": "personal",
        "group": "General",
        "preview_file_id": None,
        "preview_page": 0,
        "page_image_path": "",
    }, _id="tmpl1")
    dummy_db = DummyDB({"tmpl1": doc})
    monkeypatch.setattr(bq_router, "get_db", lambda: dummy_db)

    # stub storage bucket
    store = {}
    monkeypatch.setattr(bq_router, "get_storage_bucket", lambda: DummyBucket(store))

    # upload base64 image
    png = b"\x89PNGTEST"
    b64 = base64.b64encode(png).decode()
    body = bq_router._PageImageBase64Body(image=b64)
    out = bq_router.upload_bq_page_image_b64("tmpl1", body, user={"uid": "u1"})
    assert out["template_id"] == "tmpl1"
    # storage entry created
    assert any(p.endswith("tmpl1/page.png") for p in store.keys())
    # doc updated with path
    assert doc._data.get("page_image_path")

    # fetching should return inline base64 representation
    res = bq_router.get_bq_page_image("tmpl1", user={"uid": "u1"})
    assert res["url"].startswith("data:image/png;base64,")
    # decode and compare
    encoded = res["url"].split(",", 1)[1]
    assert base64.b64decode(encoded) == png
    assert res["source"] == "storage"
