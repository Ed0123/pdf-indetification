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
from typing import Optional, List, Any

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
CURRENT_PROJECT_NAME = "Current Project"


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


def _list_user_projects(uid: str) -> list[dict]:
    docs = get_db().collection(COLLECTION).where("owner_uid", "==", uid).stream()
    items = []
    for doc in docs:
        d = doc.to_dict()
        d["id"] = doc.id
        items.append(d)
    items.sort(key=lambda x: x.get("updated_at", ""), reverse=True)
    return items


def _find_current_project(uid: str) -> dict | None:
    for item in _list_user_projects(uid):
        if item.get("is_current"):
            return item
    return None


def _ensure_current_project(uid: str) -> dict:
    existing = _find_current_project(uid)
    if existing:
        return existing

    now = datetime.now(timezone.utc).isoformat()
    expires_at = (datetime.now(timezone.utc) + timedelta(days=14)).isoformat()
    doc_data = {
        "owner_uid": uid,
        "name": CURRENT_PROJECT_NAME,
        "size_bytes": 0,
        "pdf_count": 0,
        "page_count": 0,
        "project_json_path": "",
        "pdf_paths": [],
        "permanent": False,
        "is_current": True,
        "last_backup_at": "",
        "backup_status": "idle",
        "expires_at": expires_at,
        "created_at": now,
        "updated_at": now,
    }
    ref = get_db().collection(COLLECTION).document()
    ref.set(doc_data)
    doc_data["id"] = ref.id
    return doc_data


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


def _load_project_json_from_doc(data: dict) -> dict:
    """Load project.json from storage path on a project document."""
    json_path = data.get("project_json_path")
    if not json_path:
        return {
            "pdf_files": [],
            "columns": [],
            "templates": [],
            "last_selected_file": "",
            "last_selected_page": 0,
            "bq_page_data": {},
            "bq_templates": [],
        }

    bucket = get_storage_bucket()
    if bucket is None:
        raise HTTPException(500, "Cloud Storage not configured")

    blob = bucket.blob(json_path)
    if not blob.exists():
        return {
            "pdf_files": [],
            "columns": [],
            "templates": [],
            "last_selected_file": "",
            "last_selected_page": 0,
            "bq_page_data": {},
            "bq_templates": [],
        }
    try:
        return json.loads(blob.download_as_bytes())
    except Exception:
        raise HTTPException(422, "Stored project JSON is invalid")


def _index_files(project_data: dict) -> dict:
    return {f.get("file_id"): f for f in project_data.get("pdf_files", []) if f.get("file_id")}


def _apply_project_diff(base_data: dict, patch: dict) -> dict:
    """Apply a compact diff patch onto project JSON.

    Supported keys in ``patch``:
      - set_fields: dict
      - upsert_files: list[file]
      - remove_file_ids: list[str]
      - upsert_pages: list[{file_id, page_number, page}]
      - bq_page_data_upsert: dict[str, any]
      - bq_page_data_remove: list[str]
    """
    result = json.loads(json.dumps(base_data))

    set_fields = patch.get("set_fields") or {}
    if isinstance(set_fields, dict):
        for key, value in set_fields.items():
            result[key] = value

    files = result.get("pdf_files")
    if not isinstance(files, list):
        files = []
        result["pdf_files"] = files

    file_map = _index_files(result)

    remove_ids = patch.get("remove_file_ids") or []
    if isinstance(remove_ids, list) and remove_ids:
        remove_set = {str(fid) for fid in remove_ids}
        files = [f for f in files if f.get("file_id") not in remove_set]
        result["pdf_files"] = files
        file_map = _index_files(result)

    upsert_files = patch.get("upsert_files") or []
    if isinstance(upsert_files, list):
        for item in upsert_files:
            if not isinstance(item, dict):
                continue
            fid = item.get("file_id")
            if not fid:
                continue
            if fid in file_map:
                idx = next((i for i, f in enumerate(result["pdf_files"]) if f.get("file_id") == fid), -1)
                if idx >= 0:
                    result["pdf_files"][idx] = item
            else:
                result["pdf_files"].append(item)
            file_map[fid] = item

    upsert_pages = patch.get("upsert_pages") or []
    if isinstance(upsert_pages, list):
        for change in upsert_pages:
            if not isinstance(change, dict):
                continue
            fid = change.get("file_id")
            page_num = change.get("page_number")
            page_data = change.get("page")
            if not fid or page_num is None or not isinstance(page_data, dict):
                continue
            target_file = file_map.get(fid)
            if not isinstance(target_file, dict):
                continue
            pages = target_file.get("pages")
            if not isinstance(pages, list):
                pages = []
                target_file["pages"] = pages

            idx = next((i for i, p in enumerate(pages) if p.get("page_number") == page_num), -1)
            if idx >= 0:
                pages[idx] = page_data
            else:
                pages.append(page_data)

    bq_upsert = patch.get("bq_page_data_upsert") or {}
    if isinstance(bq_upsert, dict):
        current_bq = result.get("bq_page_data")
        if not isinstance(current_bq, dict):
            current_bq = {}
        current_bq.update(bq_upsert)
        result["bq_page_data"] = current_bq

    bq_remove = patch.get("bq_page_data_remove") or []
    if isinstance(bq_remove, list) and bq_remove:
        current_bq = result.get("bq_page_data")
        if isinstance(current_bq, dict):
            for key in bq_remove:
                current_bq.pop(str(key), None)

    return result


# ──────────────────────── Routes ─────────────────────────────────────────

@router.get("/")
def list_cloud_projects(user: dict = Depends(require_auth)):
    """List all cloud projects for the current user."""
    uid = user["uid"]
    return _list_user_projects(uid)


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
        "is_current": False,
        "last_backup_at": "",
        "backup_status": "idle",
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

def _save_project_full(uid: str, project_id: str, project_data: dict, *, source_tag: str = "manual") -> dict:
    """Persist a full project payload (JSON + PDF blobs) into Cloud Storage."""
    from backend.routers.pdf import _STORE as pdf_store

    ref = get_db().collection(COLLECTION).document(project_id)
    snap = ref.get()
    if not snap.exists:
        raise HTTPException(404, "Project not found")
    data = snap.to_dict()
    if data["owner_uid"] != uid:
        raise HTTPException(403, "Not your project")

    bucket = get_storage_bucket()
    if bucket is None:
        raise HTTPException(500, "Cloud Storage not configured")

    content = json.dumps(project_data, ensure_ascii=False).encode("utf-8")

    existing_pdf_paths = data.get("pdf_paths", []) if isinstance(data.get("pdf_paths"), list) else []
    existing_pdf_map = {
        item.get("file_id"): item
        for item in existing_pdf_paths
        if isinstance(item, dict) and item.get("file_id")
    }

    # Gather PDFs from server _STORE
    total_size = len(content)
    pdf_upload_list = []
    for f in project_data.get("pdf_files", []):
      file_id = f.get("file_id", "")
      file_name = f.get("file_name", "unknown.pdf")
      existing_meta = existing_pdf_map.get(file_id)
      if existing_meta:
          existing_path = existing_meta.get("storage_path", "")
          if existing_path:
              existing_blob = bucket.blob(existing_path)
              if existing_blob.exists():
                  # Reuse cloud-stored PDF to avoid re-upload on data-only backups.
                  file_size = int(f.get("file_size") or 0)
                  if file_size <= 0:
                      try:
                          existing_blob.reload()
                          file_size = int(existing_blob.size or 0)
                      except Exception:
                          file_size = 0
                  total_size += file_size
                  pdf_upload_list.append({
                      "file_id": file_id,
                      "file_name": file_name,
                      "path": "",
                      "size": file_size,
                      "reuse": True,
                      "storage_path": existing_path,
                  })
                  continue

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
          "reuse": False,
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

    # Upload project.json
    json_blob_path = _storage_path(uid, project_id, "project.json")
    blob = bucket.blob(json_blob_path)
    blob.upload_from_string(content, content_type="application/json")

    # Upload each PDF (reuse existing blobs when possible)
    pdf_paths = []
    active_ids = set()
    for pdf_info in pdf_upload_list:
        active_ids.add(pdf_info["file_id"])
        if pdf_info.get("reuse"):
            blob_path = pdf_info.get("storage_path") or _storage_path(uid, project_id, f"{pdf_info['file_id']}.pdf")
        else:
            blob_path = _storage_path(uid, project_id, f"{pdf_info['file_id']}.pdf")
            blob = bucket.blob(blob_path)
            blob.upload_from_filename(pdf_info["path"], content_type="application/pdf")
        pdf_paths.append({
            "file_id": pdf_info["file_id"],
            "storage_path": blob_path,
            "file_name": pdf_info["file_name"],
        })

    # Remove stale PDF blobs no longer referenced by the latest project state.
    stale_file_ids = [fid for fid in existing_pdf_map.keys() if fid not in active_ids]
    for stale_id in stale_file_ids:
        stale_meta = existing_pdf_map.get(stale_id) or {}
        stale_path = stale_meta.get("storage_path")
        if stale_path:
            try:
                bucket.blob(stale_path).delete()
            except Exception:
                logger.warning("Failed to delete stale PDF blob: %s", stale_path)

    pdf_count = len(project_data.get("pdf_files", []))
    page_count = sum(len(f.get("pages", [])) for f in project_data.get("pdf_files", []))
    now = datetime.now(timezone.utc).isoformat()
    is_permanent = data.get("permanent", False)

    ref.update({
        "project_json_path": json_blob_path,
        "pdf_paths": pdf_paths,
        "size_bytes": total_size,
        "pdf_count": pdf_count,
        "page_count": page_count,
        "backup_status": "ok",
        "last_backup_at": now,
        "updated_at": now,
        "updated_source": source_tag,
        "expires_at": "" if is_permanent else (datetime.now(timezone.utc) + timedelta(days=14)).isoformat(),
    })

    _update_storage_used(uid, total_size - old_size)

    updated = ref.get().to_dict()
    updated["id"] = project_id
    return updated

@router.post("/{project_id}/upload-full")
async def upload_project_full(
    project_id: str,
    request: Request,
    user: dict = Depends(require_auth),
):
    """Upload project JSON + all referenced PDFs to Cloud Storage."""
    uid = user["uid"]

    content = await request.body()
    try:
        project_data = json.loads(content)
    except Exception:
        raise HTTPException(400, "Invalid JSON body")
    return _save_project_full(uid, project_id, project_data, source_tag="manual")


# ──────────────────────── Full load (JSON + restore PDFs) ────────────────

def _load_project_full_data(uid: str, project_id: str) -> dict:
    """Load a project JSON and restore referenced PDFs back into runtime store."""
    from backend.routers.pdf import _STORE as pdf_store

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

    json_blob = bucket.blob(json_path)
    if not json_blob.exists():
        raise HTTPException(404, "Project JSON not found in storage")
    project_data = json.loads(json_blob.download_as_bytes())

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

    for f in project_data.get("pdf_files", []):
        old_id = f.get("file_id", "")
        if old_id in file_id_map:
            f["file_id"] = file_id_map[old_id]

    if not data.get("permanent", False):
        ref.update({
            "expires_at": (datetime.now(timezone.utc) + timedelta(days=14)).isoformat(),
        })

    if missing_pdfs:
        project_data["_warnings"] = [
            f"以下 PDF 檔案在雲端找不到，需重新上傳：{', '.join(missing_pdfs)}"
        ]

    return project_data


@router.get("/startup")
def workspace_startup(user: dict = Depends(require_auth)):
    """Return startup options for Home: current session + recent projects."""
    uid = user["uid"]
    current = _find_current_project(uid)
    recent = [p for p in _list_user_projects(uid) if not p.get("is_current")][:8]
    return {
        "current_project": current,
        "has_current_data": bool(current and current.get("project_json_path")),
        "recent_projects": recent,
    }


@router.get("/current")
def ensure_current_project(user: dict = Depends(require_auth)):
    uid = user["uid"]
    return _ensure_current_project(uid)


@router.get("/current/load-full")
def load_current_project_full(user: dict = Depends(require_auth)):
    uid = user["uid"]
    current = _ensure_current_project(uid)
    if not current.get("project_json_path"):
        return {"empty": True}
    return _load_project_full_data(uid, current["id"])


@router.post("/current/backup")
async def backup_current_project(request: Request, user: dict = Depends(require_auth)):
    uid = user["uid"]
    current = _ensure_current_project(uid)
    ref = get_db().collection(COLLECTION).document(current["id"])
    ref.update({"backup_status": "running"})
    content = await request.body()
    try:
        project_data = json.loads(content)
    except Exception:
        ref.update({"backup_status": "error"})
        raise HTTPException(400, "Invalid JSON body")

    try:
        return _save_project_full(uid, current["id"], project_data, source_tag="auto-backup")
    except Exception:
        ref.update({"backup_status": "error"})
        raise


@router.post("/current/backup-diff")
async def backup_current_project_diff(request: Request, user: dict = Depends(require_auth)):
    """Apply a compact JSON diff patch and persist the merged current workspace.

    This reduces request payload for frequent autosaves by only sending changed
    files/pages/fields, while keeping storage schema unchanged.
    """
    uid = user["uid"]
    current = _ensure_current_project(uid)
    ref = get_db().collection(COLLECTION).document(current["id"])
    ref.update({"backup_status": "running"})

    content = await request.body()
    try:
        body = json.loads(content)
    except Exception:
        ref.update({"backup_status": "error"})
        raise HTTPException(400, "Invalid JSON body")

    patch = body.get("patch")
    if not isinstance(patch, dict):
        ref.update({"backup_status": "error"})
        raise HTTPException(400, "Invalid diff payload: 'patch' is required")

    try:
        current_data = _load_project_json_from_doc(current)
        merged = _apply_project_diff(current_data, patch)
        return _save_project_full(uid, current["id"], merged, source_tag="auto-backup-diff")
    except Exception:
        ref.update({"backup_status": "error"})
        raise


@router.post("/current/reset")
def reset_current_project(body: CloudProjectCreate, user: dict = Depends(require_auth)):
    """Start a fresh current workspace while keeping old projects in history."""
    uid = user["uid"]
    existing = _find_current_project(uid)
    if existing:
        get_db().collection(COLLECTION).document(existing["id"]).update({"is_current": False})

    now = datetime.now(timezone.utc).isoformat()
    expires_at = (datetime.now(timezone.utc) + timedelta(days=14)).isoformat()
    name = body.name.strip() or CURRENT_PROJECT_NAME
    doc_data = {
        "owner_uid": uid,
        "name": name,
        "size_bytes": 0,
        "pdf_count": 0,
        "page_count": 0,
        "project_json_path": "",
        "pdf_paths": [],
        "permanent": False,
        "is_current": True,
        "last_backup_at": "",
        "backup_status": "idle",
        "expires_at": expires_at,
        "created_at": now,
        "updated_at": now,
    }
    ref = get_db().collection(COLLECTION).document()
    ref.set(doc_data)
    doc_data["id"] = ref.id
    return doc_data


@router.post("/current/restore-file/{old_file_id}")
def restore_file_from_current(old_file_id: str, user: dict = Depends(require_auth)):
    """Restore one missing PDF file from current project storage back to runtime store."""
    import fitz
    from backend.routers.pdf import _STORE as pdf_store

    uid = user["uid"]
    current = _ensure_current_project(uid)
    pdf_meta = None
    for item in current.get("pdf_paths", []):
        if item.get("file_id") == old_file_id:
            pdf_meta = item
            break
    if not pdf_meta:
        raise HTTPException(404, "PDF not found in current project backup")

    bucket = get_storage_bucket()
    if bucket is None:
        raise HTTPException(500, "Cloud Storage not configured")

    blob = bucket.blob(pdf_meta.get("storage_path", ""))
    if not blob.exists():
        raise HTTPException(404, "Backed up PDF file missing in cloud storage")

    new_file_id = str(uuid.uuid4())
    tmp_dir = tempfile.mkdtemp(prefix="cloud_restore_one_")
    dest = os.path.join(tmp_dir, f"{new_file_id}.pdf")
    blob.download_to_filename(dest)
    pdf_store[new_file_id] = dest

    try:
        doc = fitz.open(dest)
        num_pages = len(doc)
        doc.close()
    except Exception as exc:
        raise HTTPException(422, f"Cannot open restored PDF: {exc}")

    return {
        "file_id": new_file_id,
        "file_name": pdf_meta.get("file_name", "restored.pdf"),
        "num_pages": num_pages,
        "file_size": os.path.getsize(dest),
        "pages": [{"page_number": i} for i in range(num_pages)],
    }

@router.get("/{project_id}/load-full")
def load_project_full(project_id: str, user: dict = Depends(require_auth)):
    """Download project JSON and restore all PDF files into _STORE.

    PDFs are downloaded from Cloud Storage and saved to a temp directory.
    New file_ids are generated and remapped in the returned project JSON
    so that subsequent render / extract calls work immediately.
    """
    uid = user["uid"]
    return _load_project_full_data(uid, project_id)
