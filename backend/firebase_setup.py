"""Firebase Admin SDK initialisation — called once at startup.

Environment variable ``GOOGLE_APPLICATION_CREDENTIALS`` should point at
the service-account JSON file.  On Cloud Run this is set automatically
via the default service account.

When ``DEV_MODE=1`` is set, an **in-memory fake Firestore** is used so
that the entire backend can be exercised locally without any GCP
credentials.
"""

import os
import logging

_app = None
_db = None
_bucket = None
_DEV_MODE = os.getenv("DEV_MODE", "").strip() in ("1", "true", "yes")

logger = logging.getLogger(__name__)


# ──────────────────────────────────────────────────────────────────────
# In-memory Firestore stub for local development
# ──────────────────────────────────────────────────────────────────────

class _FakeDocSnap:
    """Mimics a Firestore DocumentSnapshot."""
    def __init__(self, data: dict | None):
        self._data = data
        self.exists = data is not None

    def to_dict(self):
        return dict(self._data) if self._data else {}


class _FakeDocRef:
    """Mimics a Firestore DocumentReference."""
    def __init__(self, collection: "_FakeCollection", doc_id: str):
        self._col = collection
        self.id = doc_id

    def get(self):
        return _FakeDocSnap(self._col._store.get(self.id))

    def set(self, data: dict):
        self._col._store[self.id] = dict(data)

    def update(self, changes: dict):
        existing = self._col._store.get(self.id, {})
        existing.update(changes)
        self._col._store[self.id] = existing

    def delete(self):
        self._col._store.pop(self.id, None)


class _FakeCollection:
    """Mimics a Firestore CollectionReference."""
    _counter = 0

    def __init__(self):
        self._store: dict[str, dict] = {}

    def document(self, doc_id: str | None = None):
        if doc_id is None:
            _FakeCollection._counter += 1
            doc_id = f"auto-{_FakeCollection._counter}"
        return _FakeDocRef(self, doc_id)

    def stream(self):
        for doc_id, data in list(self._store.items()):
            snap = _FakeDocSnap(data)
            snap.id = doc_id  # type: ignore[attr-defined]
            yield snap


class _FakeFirestore:
    """Mimics ``firestore.Client`` with an in-memory dict backend."""
    def __init__(self):
        self._collections: dict[str, _FakeCollection] = {}

    def collection(self, name: str):
        if name not in self._collections:
            self._collections[name] = _FakeCollection()
        return self._collections[name]


# ──────────────────────────────────────────────────────────────────────


def init_firebase():
    """Initialise the default Firebase app (idempotent)."""
    global _app, _db
    if _app is not None:
        return

    if _DEV_MODE:
        logger.info("DEV_MODE: using in-memory fake Firestore (no GCP credentials needed)")
        _db = _FakeFirestore()
        _app = "dev-stub"
        return

    import firebase_admin
    from firebase_admin import credentials, firestore

    # Determine storage bucket name for Firebase init
    storage_bucket = os.getenv("STORAGE_BUCKET", "")
    init_opts = {}
    if storage_bucket:
        init_opts["storageBucket"] = storage_bucket

    cred_path = os.getenv("GOOGLE_APPLICATION_CREDENTIALS")
    if cred_path and os.path.isfile(cred_path):
        cred = credentials.Certificate(cred_path)
        _app = firebase_admin.initialize_app(cred, init_opts)
    else:
        # On Cloud Run the default credentials are provided automatically
        _app = firebase_admin.initialize_app(options=init_opts)
    _db = firestore.client()


def get_db():
    """Return the Firestore ``Client`` instance (or fake in DEV_MODE)."""
    global _db
    if _db is None:
        init_firebase()
    return _db


def get_storage_bucket():
    """Return the default Cloud Storage bucket.

    Bucket name follows Firebase convention: ``<project-id>.firebasestorage.app``.
    Override with env var ``STORAGE_BUCKET`` if needed.
    """
    global _bucket
    if _bucket is not None:
        return _bucket

    if _DEV_MODE:
        logger.info("DEV_MODE: Cloud Storage not available — returning None")
        return None

    if _app is None:
        init_firebase()

    from firebase_admin import storage as _fb_storage
    bucket_name = os.getenv("STORAGE_BUCKET", "")
    if bucket_name:
        _bucket = _fb_storage.bucket(bucket_name)
    else:
        # Try default Firebase bucket
        _bucket = _fb_storage.bucket()
    return _bucket


def verify_token(id_token: str) -> dict:
    """Verify a Firebase ID token and return the decoded claims.

    Raises ``firebase_admin.auth.InvalidIdTokenError`` on failure.
    In DEV_MODE, raises if called (auth middleware should bypass first).
    """
    if _DEV_MODE:
        raise RuntimeError("verify_token called in DEV_MODE — auth middleware should bypass")

    if _app is None:
        init_firebase()

    from firebase_admin import auth as firebase_auth
    return firebase_auth.verify_id_token(id_token)
