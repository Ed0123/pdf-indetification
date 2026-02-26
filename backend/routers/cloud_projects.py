"""Cloud project management — save & load projects to/from Firestore + Cloud Storage.

Each project doc lives under ``cloud_projects/{project_id}``:
  - owner_uid
  - name
  - created_at / updated_at
  - size_bytes  (JSON + PDFs)
  - pdf_count, page_count
  - project_json_path  (Cloud Storage path to the project JSON)
  - pdf_paths  [{file_id, storage_path, file_name}]

Routes:
    GET    /api/projects/cloud/          — list user's projects
    POST   /api/projects/cloud/          — save a new cloud project
    PUT    /api/projects/cloud/{id}      — update an existing project
    DELETE /api/projects/cloud/{id}      — delete a project
    GET    /api/projects/cloud/{id}/load — download project JSON
"""

import json
import logging
import os
import uuid
import tempfile
from datetime import datetime, timezone, timedelta
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Request
from fastapi.responses import StreamingResponse, JSONResponse
from pydantic import BaseModel
import io

from backend.auth_middleware import require_auth
from backend.firebase_setup import get_db, get_storage_bucket

router = APIRouter()
logger = logging.getLogger(__name__)

COLLECTION = "cloud_projects"
USERS_COLLECTION = "users"
STORAGE_PREFIX = "cloud_projects"


# ──────────────────────── Models ─────────────────────────────────────────

class CloudProjectCreate(BaseModel):
    name: str


class CloudProjectUpdate(BaseModel):
    name: Optional[str] = None
    permanent: Optional[bool] = None


class CloudProjectInfo(BaseModel):
    id: str
    name: str
    owner_uid: str
    size_bytes: int
    pdf_count: int
    page_count: int
    created_at: str
    updated_at: str


# ──────────────────────── Helpers ────────────────────────────────────────

def _get_user_tier(uid: str) -> dict:
    """Return user's tier info including storage_quota_mb."""
    db = get_db()
    user_snap = db.collection(USERS_COLLECTION).document(uid).get()
    if not user_snap.exists:
        return {"tier": "basic", "storage_quota_mb": 0, "storage_used_bytes": 0}

    profile = user_snap.to_dict()
    tier_name = profile.get("tier", "basic")
    storage_used = profile.get("storage_used_bytes", 0)

    # Look up tier quota
    tiers = list(db.collection("tiers").stream())
    storage_quota_mb = 0
    for t in tiers:
        td = t.to_dict()
        if td.get("name") == tier_name:
            storage_quota_mb = td.get("storage_quota_mb", 0)
            break

    return {
        "tier": tier_name,
        "storage_quota_mb": storage_quota_mb,
        "storage_used_bytes": storage_used,
    }


def _update_storage_used(uid: str, delta_bytes: int):
    """Atomically update a user's storage_used_bytes by delta_bytes."""
    ref = get_db().collection(USERS_COLLECTION).document(uid)
    snap = ref.get()
    if snap.exists:
        current = snap.to_dict().get("storage_used_bytes", 0)
        ref.update({"storage_used_bytes": max(0, current + delta_bytes)})


def _storage_path(uid: str, project_id: str, filename: str) -> str:
    return f"{STORAGE_PREFIX}/{uid}/{project_id}/{filename}"


def _delete_project_storage(uid: str, project_id: str):
    """Delete all Cloud Storage objects for a project."""
    bucket = get_storage_bucket()
    if bucket is None:
        return
    prefix = f"{STORAGE_PREFIX}/{uid}/{project_id}/"
    try:
        blobs = list(bucket.list_blobs(prefix=prefix))
        for blob in blobs:
            blob.delete()
    except Exception as exc:
        logger.warning("Failed to delete storage for project %s: %s", project_id, exc)


# ──────────────────────── Routes ─────────────────────────────────────────

@router.get("/")
def list_cloud_projects(user: dict = Depends(require_auth)):
    """List all cloud projects for the current user."""
    uid = user["uid"]
    docs = get_db().collection(COLLECTION).where("owner_uid", "==", uid).stream()
    result = []
    for doc in docs:
        d = doc.to_dict()
        d["id"] = doc.id
        result.append(d)
    # Sort by updated_at desc
    result.sort(key=lambda x: x.get("updated_at", ""), reverse=True)
    return result


@router.post("/")
def create_cloud_project(body: CloudProjectCreate, user: dict = Depends(require_auth)):
    """Create a new cloud project (metadata only; upload JSON separately)."""
    uid = user["uid"]

    # Check feature access
    tier_info = _get_user_tier(uid)
    if tier_info["storage_quota_mb"] == 0:
        raise HTTPException(403, "Your tier does not include cloud storage")

    now = datetime.now(timezone.utc).isoformat()
    expires_at = (datetime.now(timezone.utc) + timedelta(days=14)).isoformat()
    doc_data = {
        "owner_uid": uid,
        "name": body.name.strip() or "Untitled",
        "size_bytes": 0,
        "pdf_count": 0,
        "page_count": 0,
        "project_json_path": "",
        "pdf_paths": [],
        "permanent": False,
        "expires_at": expires_at,
        "created_at": now,
        "updated_at": now,
    }
    ref = get_db().collection(COLLECTION).document()
    ref.set(doc_data)
    doc_data["id"] = ref.id
    return doc_data


@router.post("/{project_id}/upload-json")
async def upload_project_json(
    project_id: str,
    file: UploadFile = File(...),
    user: dict = Depends(require_auth),
):
    """Upload the project JSON blob to Cloud Storage."""
    uid = user["uid"]

    # Verify ownership
    ref = get_db().collection(COLLECTION).document(project_id)
    snap = ref.get()
    if not snap.exists:
        raise HTTPException(404, "Project not found")
    data = snap.to_dict()
    if data["owner_uid"] != uid:
        raise HTTPException(403, "Not your project")

    content = await file.read()
    new_size = len(content)

    # Check storage quota
    tier_info = _get_user_tier(uid)
    quota_bytes = tier_info["storage_quota_mb"] * 1024 * 1024 if tier_info["storage_quota_mb"] > 0 else float("inf")
    old_size = data.get("size_bytes", 0)
    projected = tier_info["storage_used_bytes"] - old_size + new_size
    if tier_info["storage_quota_mb"] != -1 and projected > quota_bytes:
        raise HTTPException(
            413,
            f"Storage quota exceeded. Used: {tier_info['storage_used_bytes'] // 1024}KB, "
            f"Limit: {tier_info['storage_quota_mb']}MB"
        )

    # Upload to Cloud Storage
    bucket = get_storage_bucket()
    if bucket is None:
        raise HTTPException(500, "Cloud Storage not configured")

    blob_path = _storage_path(uid, project_id, "project.json")
    blob = bucket.blob(blob_path)
    blob.upload_from_string(content, content_type="application/json")

    # Parse to get counts
    try:
        project_data = json.loads(content)
        pdf_count = len(project_data.get("pdf_files", []))
        page_count = sum(len(f.get("pages", [])) for f in project_data.get("pdf_files", []))
    except Exception:
        pdf_count = 0
        page_count = 0

    # Update metadata
    ref.update({
        "project_json_path": blob_path,
        "size_bytes": new_size,
        "pdf_count": pdf_count,
        "page_count": page_count,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    })

    # Update user storage used
    _update_storage_used(uid, new_size - old_size)

    updated = ref.get().to_dict()
    updated["id"] = project_id
    return updated


@router.get("/{project_id}/load")
def load_cloud_project(project_id: str, user: dict = Depends(require_auth)):
    """Download the project JSON from Cloud Storage."""
    uid = user["uid"]

    ref = get_db().collection(COLLECTION).document(project_id)
    snap = ref.get()
    if not snap.exists:
        raise HTTPException(404, "Project not found")
    data = snap.to_dict()
    if data["owner_uid"] != uid:
        raise HTTPException(403, "Not your project")

    json_path = data.get("project_json_path")
    if not json_path:
        raise HTTPException(404, "Project has no saved data")

    bucket = get_storage_bucket()
    if bucket is None:
        raise HTTPException(500, "Cloud Storage not configured")

    blob = bucket.blob(json_path)
    if not blob.exists():
        raise HTTPException(404, "Project data file not found in storage")

    content = blob.download_as_bytes()
    return StreamingResponse(
        io.BytesIO(content),
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="{data.get("name", "project")}.json"'},
    )


@router.put("/{project_id}")
def update_cloud_project(project_id: str, body: CloudProjectUpdate, user: dict = Depends(require_auth)):
    """Update project metadata (name)."""
    uid = user["uid"]
    ref = get_db().collection(COLLECTION).document(project_id)
    snap = ref.get()
    if not snap.exists:
        raise HTTPException(404, "Project not found")
    data = snap.to_dict()
    if data["owner_uid"] != uid:
        raise HTTPException(403, "Not your project")

    changes = {}
    if body.name is not None:
        changes["name"] = body.name.strip()
    if body.permanent is not None:
        changes["permanent"] = body.permanent
        if body.permanent:
            changes["expires_at"] = ""
        else:
            changes["expires_at"] = (datetime.now(timezone.utc) + timedelta(days=14)).isoformat()
    changes["updated_at"] = datetime.now(timezone.utc).isoformat()

    ref.update(changes)
    updated = ref.get().to_dict()
    updated["id"] = project_id
    return updated


@router.delete("/{project_id}")
def delete_cloud_project(project_id: str, user: dict = Depends(require_auth)):
    """Delete a cloud project and its storage."""
    uid = user["uid"]
    ref = get_db().collection(COLLECTION).document(project_id)
    snap = ref.get()
    if not snap.exists:
        raise HTTPException(404, "Project not found")
    data = snap.to_dict()
    if data["owner_uid"] != uid:
        raise HTTPException(403, "Not your project")

    size = data.get("size_bytes", 0)
    _delete_project_storage(uid, project_id)
    ref.delete()
    _update_storage_used(uid, -size)

    return {"deleted": project_id}


# ──────────────────────── Full upload (JSON + PDFs) ──────────────────────

@router.post("/{project_id}/upload-full")
async def upload_project_full(
    project_id: str,
    request: Request,
    user: dict = Depends(require_auth),
):
    """Upload project JSON + all referenced PDF files to Cloud Storage.

    The endpoint reads each PDF from the in-memory _STORE (server temp disk)
    and uploads both the project JSON and all PDFs to Cloud Storage so that
    the project can be fully restored later.
    """
    from backend.routers.pdf import _STORE as pdf_store

    uid = user["uid"]

    # Verify ownership
    ref = get_db().collection(COLLECTION).document(project_id)
    snap = ref.get()
    if not snap.exists:
        raise HTTPException(404, "Project not found")
    data = snap.to_dict()
    if data["owner_uid"] != uid:
        raise HTTPException(403, "Not your project")

    content = await request.body()
    try:
        project_data = json.loads(content)
    except Exception:
        raise HTTPException(400, "Invalid JSON body")

    bucket = get_storage_bucket()
    if bucket is None:
        raise HTTPException(500, "Cloud Storage not configured")

    # Gather PDFs from server _STORE
    total_size = len(content)
    pdf_upload_list = []
    for f in project_data.get("pdf_files", []):
        file_id = f.get("file_id", "")
        file_name = f.get("file_name", "unknown.pdf")
        path = pdf_store.get(file_id)
        if not path or not os.path.exists(path):
            raise HTTPException(
                400,
                f"PDF 檔案 '{file_name}' 在伺服器上找不到。請重新上傳該檔案後再保存。",
            )
        file_size = os.path.getsize(path)
        total_size += file_size
        pdf_upload_list.append({
            "file_id": file_id,
            "file_name": file_name,
            "path": path,
            "size": file_size,
        })

    # Check storage quota
    tier_info = _get_user_tier(uid)
    old_size = data.get("size_bytes", 0)
    if tier_info["storage_quota_mb"] != -1:
        quota_bytes = (
            tier_info["storage_quota_mb"] * 1024 * 1024
            if tier_info["storage_quota_mb"] > 0
            else 0
        )
        projected = tier_info["storage_used_bytes"] - old_size + total_size
        if projected > quota_bytes:
            avail = max(0, quota_bytes - tier_info["storage_used_bytes"] + old_size)
            raise HTTPException(
                413,
                f"雲端儲存空間不足。需要 {total_size // 1024} KB，"
                f"可用 {avail // 1024} KB。",
            )

    # Delete old blobs first
    _delete_project_storage(uid, project_id)

    # Upload project.json
    json_blob_path = _storage_path(uid, project_id, "project.json")
    blob = bucket.blob(json_blob_path)
    blob.upload_from_string(content, content_type="application/json")

    # Upload each PDF
    pdf_paths = []
    for pdf_info in pdf_upload_list:
        blob_path = _storage_path(uid, project_id, f"{pdf_info['file_id']}.pdf")
        blob = bucket.blob(blob_path)
        blob.upload_from_filename(pdf_info["path"], content_type="application/pdf")
        pdf_paths.append({
            "file_id": pdf_info["file_id"],
            "storage_path": blob_path,
            "file_name": pdf_info["file_name"],
        })

    # Counts
    pdf_count = len(project_data.get("pdf_files", []))
    page_count = sum(
        len(f.get("pages", [])) for f in project_data.get("pdf_files", [])
    )
    now = datetime.now(timezone.utc).isoformat()
    is_permanent = data.get("permanent", False)

    ref.update({
        "project_json_path": json_blob_path,
        "pdf_paths": pdf_paths,
        "size_bytes": total_size,
        "pdf_count": pdf_count,
        "page_count": page_count,
        "updated_at": now,
        "expires_at": "" if is_permanent else (datetime.now(timezone.utc) + timedelta(days=14)).isoformat(),
    })

    _update_storage_used(uid, total_size - old_size)

    updated = ref.get().to_dict()
    updated["id"] = project_id
    return updated


# ──────────────────────── Full load (JSON + restore PDFs) ────────────────

@router.get("/{project_id}/load-full")
def load_project_full(project_id: str, user: dict = Depends(require_auth)):
    """Download project JSON and restore all PDF files into _STORE.

    PDFs are downloaded from Cloud Storage and saved to a temp directory.
    New file_ids are generated and remapped in the returned project JSON
    so that subsequent render / extract calls work immediately.
    """
    from backend.routers.pdf import _STORE as pdf_store

    uid = user["uid"]

    ref = get_db().collection(COLLECTION).document(project_id)
    snap = ref.get()
    if not snap.exists:
        raise HTTPException(404, "Project not found")
    data = snap.to_dict()
    if data["owner_uid"] != uid:
        raise HTTPException(403, "Not your project")

    json_path = data.get("project_json_path")
    if not json_path:
        raise HTTPException(404, "Project has no saved data")

    bucket = get_storage_bucket()
    if bucket is None:
        raise HTTPException(500, "Cloud Storage not configured")

    # Download project JSON
    json_blob = bucket.blob(json_path)
    if not json_blob.exists():
        raise HTTPException(404, "Project JSON not found in storage")
    project_data = json.loads(json_blob.download_as_bytes())

    # Download PDFs → temp dir → register in _STORE with new file_ids
    file_id_map: dict[str, str] = {}
    tmp_dir = tempfile.mkdtemp(prefix="cloud_restore_")
    missing_pdfs = []

    for pdf_info in data.get("pdf_paths", []):
        old_file_id = pdf_info["file_id"]
        storage_path = pdf_info["storage_path"]

        blob = bucket.blob(storage_path)
        if not blob.exists():
            logger.warning("PDF blob missing in storage: %s", storage_path)
            missing_pdfs.append(pdf_info.get("file_name", old_file_id))
            continue

        new_file_id = str(uuid.uuid4())
        dest = os.path.join(tmp_dir, f"{new_file_id}.pdf")
        blob.download_to_filename(dest)
        pdf_store[new_file_id] = dest
        file_id_map[old_file_id] = new_file_id

    # Remap file_ids in the project data
    for f in project_data.get("pdf_files", []):
        old_id = f.get("file_id", "")
        if old_id in file_id_map:
            f["file_id"] = file_id_map[old_id]

    # Extend TTL on load (non-permanent projects)
    if not data.get("permanent", False):
        ref.update({
            "expires_at": (datetime.now(timezone.utc) + timedelta(days=14)).isoformat(),
        })

    # Attach warnings if any PDFs were missing
    if missing_pdfs:
        project_data["_warnings"] = [
            f"以下 PDF 檔案在雲端找不到，需重新上傳：{', '.join(missing_pdfs)}"
        ]

    return project_data
