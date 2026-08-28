"""Persisted history of on-demand prefill runs (service, when, exit code,
how long it took). Same JSON-file-on-/data pattern as app_settings_store.py,
but unencrypted -- nothing sensitive in here, just run metadata.
"""

import json
import os
import tempfile
from pathlib import Path
from threading import Lock

_STORE_PATH = Path(os.environ.get("RUN_HISTORY_PATH", "/data/run_history.json"))
_lock = Lock()
_MAX_ENTRIES = 50


def _read_all() -> list[dict]:
    if not _STORE_PATH.exists():
        return []
    try:
        data = json.loads(_STORE_PATH.read_text(encoding="utf-8"))
        return data if isinstance(data, list) else []
    except (json.JSONDecodeError, UnicodeDecodeError, OSError):
        return []


def _write_all(entries: list[dict]) -> None:
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
        entries = _read_all()
        entries.insert(0, entry)
        entries = entries[:_MAX_ENTRIES]
        _write_all(entries)
    return entry


def get_history() -> list[dict]:
    with _lock:
        return _read_all()
