"""Assembles the full-state backup bundle -- the same data
routers/backup.py's GET /api/backup returns, factored out into the service
layer so scheduler_service.py's automatic-backup job (3rd feature round,
Welle 2) can produce byte-for-byte the same structure without a router
importing a scheduler or a service importing a router. One place builds a
backup, both callers use it, same "don't let two paths silently drift
apart" reasoning as cache_report.py.

See routers/backup.py's own module docstring for the full reasoning behind
what is (settings, as an undecrypted Fernet blob) and isn't (a portable,
cross-host-restorable secret) included here.
"""

import base64
import json
import os
from datetime import datetime, timezone
from pathlib import Path

from app.services import app_settings_store, auth_credentials_store, run_history_store, schedule_store

SCHEMA_VERSION = 1

# Automatic scheduled backups (scheduler_service.py) land here, separate
# from the ./data files the app reads on every request -- these are
# disposable snapshots a user can delete/copy/rsync freely, never read back
# by the app itself except via a manual restore upload.
_AUTO_BACKUPS_DIR = Path(os.environ.get("AUTO_BACKUPS_DIR", "/data/backups"))


def build_backup_bundle() -> dict:
    return {
        "schema_version": SCHEMA_VERSION,
        "settings_encrypted": base64.b64encode(app_settings_store.get_encrypted_blob()).decode("ascii"),
        "schedule": schedule_store.get_schedule(),
        "run_history": run_history_store.get_history(),
        "auth": auth_credentials_store.get_credentials(),
    }


def write_auto_backup(retention: int) -> Path:
    """Called by scheduler_service.py's automatic-backup job. Writes a
    timestamped snapshot into _AUTO_BACKUPS_DIR, then deletes the oldest
    ones beyond `retention` -- scoped to files matching this function's own
    `backup-*.json` naming pattern, so nothing else a user might place in
    that directory is ever touched by the retention cleanup. No temp-file
    dance needed here (unlike the live ./data files each store atomically
    replaces): this always writes a brand-new, uniquely-timestamped file
    that nothing reads until it's fully written, so there's no concurrent
    reader that could observe a half-written file."""
    _AUTO_BACKUPS_DIR.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    path = _AUTO_BACKUPS_DIR / f"backup-{timestamp}.json"
    path.write_text(json.dumps(build_backup_bundle()), encoding="utf-8")
    os.chmod(path, 0o600)

    existing = sorted(_AUTO_BACKUPS_DIR.glob("backup-*.json"), key=lambda p: p.name, reverse=True)
    for stale in existing[max(retention, 0):]:
        stale.unlink(missing_ok=True)

    return path
