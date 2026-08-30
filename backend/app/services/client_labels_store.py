"""Human-readable names for client IPs (e.g. "Gaming-PC" for 10.0.0.50),
shown in the dashboard's top-clients list and live ticker instead of a bare
address. Same file+Postgres double pattern as schedule_store.py, but
deliberately NOT routed through app_settings_store.py -- that store exists
for secrets that need Fernet encryption at rest (see its own docstring), and
a device nickname is not sensitive data, so adding it there would be the
wrong trust tier for no benefit.

Unlike schedule_store.py's fixed three-service dict, the key space here
(arbitrary client IPs) is open-ended, so this is a plain {ip: label} map
rather than a schema with known keys.
"""

import json
import os
import tempfile
from pathlib import Path
from threading import Lock

from app.services import db

_STORE_PATH = Path(os.environ.get("CLIENT_LABELS_PATH", "/data/client_labels.json"))
_lock = Lock()


def _read_raw_file() -> dict[str, str]:
    if not _STORE_PATH.exists():
        return {}
    try:
        data = json.loads(_STORE_PATH.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError, OSError):
        return {}
    if not isinstance(data, dict):
        return {}
    return {str(k): str(v) for k, v in data.items() if isinstance(k, str) and isinstance(v, str)}


def _read_raw_db() -> dict[str, str]:
    with db.get_connection() as conn:
        rows = conn.execute("SELECT ip, label FROM client_labels").fetchall()
    return {ip: label for ip, label in rows}


def _write_raw_file(labels: dict[str, str]) -> None:
    _STORE_PATH.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(dir=_STORE_PATH.parent, prefix=".client-labels-", suffix=".json")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(labels, f)
        os.replace(tmp_path, _STORE_PATH)
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)


def get_labels() -> dict[str, str]:
    with _lock:
        return _read_raw_db() if db.is_enabled() else _read_raw_file()


def set_label(ip: str, label: str) -> dict[str, str]:
    with _lock:
        if db.is_enabled():
            with db.get_connection() as conn:
                conn.execute(
                    "INSERT INTO client_labels (ip, label) VALUES (%s, %s) "
                    "ON CONFLICT (ip) DO UPDATE SET label = EXCLUDED.label",
                    (ip, label),
                )
            return _read_raw_db()

        labels = _read_raw_file()
        labels[ip] = label
        _write_raw_file(labels)
        return labels


def delete_label(ip: str) -> dict[str, str]:
    with _lock:
        if db.is_enabled():
            with db.get_connection() as conn:
                conn.execute("DELETE FROM client_labels WHERE ip = %s", (ip,))
            return _read_raw_db()

        labels = _read_raw_file()
        labels.pop(ip, None)
        _write_raw_file(labels)
        return labels
