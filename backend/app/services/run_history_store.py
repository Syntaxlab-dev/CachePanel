"""Persisted history of on-demand prefill runs (service, when, exit code,
how long it took). Same JSON-file-on-/data pattern as app_settings_store.py,
but unencrypted -- nothing sensitive in here, just run metadata. Also has
an optional Postgres-backed path, see db.py -- behind DATABASE_URL only.
"""

import json
import os
import tempfile
from pathlib import Path
from threading import Lock

from app.services import db

_STORE_PATH = Path(os.environ.get("RUN_HISTORY_PATH", "/data/run_history.json"))
_lock = Lock()
_MAX_ENTRIES = 50


def _read_all_file() -> list[dict]:
    if not _STORE_PATH.exists():
        return []
    try:
        data = json.loads(_STORE_PATH.read_text(encoding="utf-8"))
        return data if isinstance(data, list) else []
    except (json.JSONDecodeError, UnicodeDecodeError, OSError):
        return []


def _write_all_file(entries: list[dict]) -> None:
    _STORE_PATH.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(dir=_STORE_PATH.parent, prefix=".run_history-", suffix=".json")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(entries, f, indent=2)
        os.replace(tmp_path, _STORE_PATH)
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)


def add_entry(service: str, started_at: str, exit_code: int, duration_seconds: float) -> dict:
    entry = {
        "service": service,
        "started_at": started_at,
        "exit_code": exit_code,
        "duration_seconds": round(duration_seconds, 1),
    }
    with _lock:
        if db.is_enabled():
            with db.get_connection() as conn:
                conn.execute(
                    "INSERT INTO run_history (service, started_at, exit_code, duration_seconds) "
                    "VALUES (%s, %s, %s, %s)",
                    (entry["service"], entry["started_at"], entry["exit_code"], entry["duration_seconds"]),
                )
                # Same _MAX_ENTRIES cap as the file store, enforced here
                # instead of by truncating a list before writing it back.
                conn.execute(
                    "DELETE FROM run_history WHERE id NOT IN "
                    "(SELECT id FROM run_history ORDER BY id DESC LIMIT %s)",
                    (_MAX_ENTRIES,),
                )
        else:
            entries = _read_all_file()
            entries.insert(0, entry)
            entries = entries[:_MAX_ENTRIES]
            _write_all_file(entries)
    return entry


def get_history() -> list[dict]:
    with _lock:
        if not db.is_enabled():
            return _read_all_file()

        with db.get_connection() as conn:
            rows = conn.execute(
                "SELECT service, started_at, exit_code, duration_seconds "
                "FROM run_history ORDER BY id DESC LIMIT %s",
                (_MAX_ENTRIES,),
            ).fetchall()
        return [
            {"service": r[0], "started_at": r[1], "exit_code": r[2], "duration_seconds": r[3]} for r in rows
        ]
