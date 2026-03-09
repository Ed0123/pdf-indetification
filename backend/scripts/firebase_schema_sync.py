"""Firestore schema sync utility.

Run before deployment to backfill missing fields introduced by new backend
features, so older Firebase documents remain compatible.

Usage:
    python -m backend.scripts.firebase_schema_sync
    python -m backend.scripts.firebase_schema_sync --dry-run
"""

from __future__ import annotations

import argparse
from datetime import datetime, timezone, timedelta

from backend.firebase_setup import init_firebase, get_db
from backend.routers.users import DEFAULT_GROUPS, _ensure_default_tiers


def _apply_update(ref, changes: dict, dry_run: bool) -> bool:
    if not changes:
        return False
    if not dry_run:
        ref.update(changes)
    return True


def ensure_groups(db, dry_run: bool) -> dict:
    coll = db.collection("groups")
    docs = list(coll.stream())
    names = {str((d.to_dict() or {}).get("name") or "").strip() for d in docs}
    names.discard("")

    created = 0
    for group_name in DEFAULT_GROUPS:
        if group_name in names:
            continue
        if not dry_run:
            coll.document().set({"name": group_name})
        created += 1
    return {"created": created, "total_after": len(names) + created}


def ensure_tiers(dry_run: bool) -> dict:
    if dry_run:
        # In dry-run we still call the loader to inspect, but do not mutate.
        # _ensure_default_tiers updates data when needed, so avoid calling it here.
        db = get_db()
        total = len(list(db.collection("tiers").stream()))
        return {"total": total, "normalized": "skipped (dry-run)"}

    tiers = _ensure_default_tiers(force_refresh=True)
    return {"total": len(tiers), "normalized": "ok"}


def ensure_users(db, dry_run: bool) -> dict:
    coll = db.collection("users")
    docs = list(coll.stream())
    now_iso = datetime.now(timezone.utc).isoformat()
    usage_month = datetime.now(timezone.utc).strftime("%Y-%m")

    tier_names = {str((d.to_dict() or {}).get("name") or "") for d in db.collection("tiers").stream()}
    if not tier_names:
        tier_names = {"basic"}

    groups = [str((d.to_dict() or {}).get("name") or "").strip() for d in db.collection("groups").stream()]
    groups = [g for g in groups if g]
    default_group = groups[0] if groups else (DEFAULT_GROUPS[0] if DEFAULT_GROUPS else "General")

    updated = 0
    for d in docs:
        data = d.to_dict() or {}
        uid = d.id

        defaults = {
            "uid": uid,
            "email": "",
            "display_name": "",
            "salutation": "",
            "whatsapp": "",
            "tier": "basic",
            "status": "pending",
            "group": default_group,
            "usage_month": usage_month,
            "usage_pages": 0,
            "created_at": now_iso,
            "last_login": now_iso,
            "notes": "",
            "photo_url": "",
            "storage_used_bytes": 0,
        }

        changes = {}
        for key, default_value in defaults.items():
            if key not in data:
                changes[key] = default_value

        current_tier = str(data.get("tier") or changes.get("tier") or "basic")
        if current_tier not in tier_names:
            changes["tier"] = "basic"

        current_group = str(data.get("group") or changes.get("group") or "").strip()
        if not current_group:
            changes["group"] = default_group

        if _apply_update(coll.document(uid), changes, dry_run):
            updated += 1

    return {"updated": updated, "total": len(docs)}


def ensure_cloud_projects(db, dry_run: bool) -> dict:
    coll = db.collection("cloud_projects")
    docs = list(coll.stream())
    now = datetime.now(timezone.utc)

    updated = 0
    for d in docs:
        data = d.to_dict() or {}
        expires_at = (now + timedelta(days=14)).isoformat()
        defaults = {
            "owner_uid": "",
            "name": "Untitled",
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
            "created_at": now.isoformat(),
            "updated_at": now.isoformat(),
        }

        changes = {k: v for k, v in defaults.items() if k not in data}
        if _apply_update(coll.document(d.id), changes, dry_run):
            updated += 1

    return {"updated": updated, "total": len(docs)}


def ensure_system_updates(db, dry_run: bool) -> dict:
    coll = db.collection("system_updates")
    docs = list(coll.stream())
    now_iso = datetime.now(timezone.utc).isoformat()

    updated = 0
    for d in docs:
        data = d.to_dict() or {}
        defaults = {
            "heading": "系統更新",
            "content": "",
            "created_at": now_iso,
            "created_by": "system",
            "source": "admin",
        }
        changes = {}
        for key, default_value in defaults.items():
            if key not in data:
                changes[key] = default_value

        # Keep update feed sane: content is required for UI display
        if not str(data.get("content") or "").strip() and "content" not in changes:
            changes["content"] = "（自動補齊）"

        if _apply_update(coll.document(d.id), changes, dry_run):
            updated += 1

    return {"updated": updated, "total": len(docs)}


# All module IDs that support the "說明" (instruction) panel
_MODULE_IDS = [
    "home", "singlepage", "bq_ocr", "bq_export",
    "templates", "exportexcel", "exportpdf",
    "pdf_excel_unlock", "pdf_search",
]


def ensure_module_instructions(db, dry_run: bool) -> dict:
    """Bootstrap empty instruction docs so the API never 404s."""
    coll = db.collection("module_instructions")
    existing = {d.id for d in coll.stream()}

    created = 0
    for mid in _MODULE_IDS:
        if mid in existing:
            continue
        if not dry_run:
            coll.document(mid).set({"content_html": "", "updated_at": "", "updated_by": ""})
        created += 1

    return {"created": created, "total_after": len(existing) + created}


def main() -> int:
    parser = argparse.ArgumentParser(description="Sync Firebase/Firestore schema defaults.")
    parser.add_argument("--dry-run", action="store_true", help="Show intended changes without writing")
    args = parser.parse_args()

    init_firebase()
    db = get_db()

    print("[schema-sync] start", "(dry-run)" if args.dry_run else "")

    group_result = ensure_groups(db, args.dry_run)
    tier_result = ensure_tiers(args.dry_run)
    user_result = ensure_users(db, args.dry_run)
    project_result = ensure_cloud_projects(db, args.dry_run)
    updates_result = ensure_system_updates(db, args.dry_run)
    instructions_result = ensure_module_instructions(db, args.dry_run)

    print(f"[schema-sync] groups: {group_result}")
    print(f"[schema-sync] tiers: {tier_result}")
    print(f"[schema-sync] users: {user_result}")
    print(f"[schema-sync] cloud_projects: {project_result}")
    print(f"[schema-sync] system_updates: {updates_result}")
    print(f"[schema-sync] module_instructions: {instructions_result}")
    print("[schema-sync] done")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
