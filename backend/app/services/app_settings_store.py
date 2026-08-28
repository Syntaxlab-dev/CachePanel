"""Persisted, user-editable settings (e.g. Steam credentials entered via the UI).

Kept separate from app.settings.Settings, which only holds deploy-time
infrastructure config (paths, container names) meant to be set once via
environment variables. Anything a user of CachePanel should be able to type
into the web UI itself (so nobody has to hand their own API keys to whoever
deployed the instance) lives here instead, in a small JSON file on disk.
"""

import json
import os
import tempfile
from pathlib import Path
from threading import Lock

_STORE_PATH = Path(os.environ.get("APP_SETTINGS_PATH", "/data/settings.json"))
_lock = Lock()

_DEFAULTS = {
    "steam_api_key": "",
    "steam_id64": "",
}


def _read_raw() -> dict:
    if not _STORE_PATH.exists():
        return dict(_DEFAULTS)
    try:
        with _STORE_PATH.open("r", encoding="utf-8") as f:
            data = json.load(f)
    except (json.JSONDecodeError, OSError):
        return dict(_DEFAULTS)
    merged = dict(_DEFAULTS)
    merged.update({k: v for k, v in data.items() if k in _DEFAULTS})
    return merged


def get_settings() -> dict:
    with _lock:
        return _read_raw()


def update_settings(partial: dict) -> dict:
    with _lock:
        current = _read_raw()
        current.update({k: v for k, v in partial.items() if k in _DEFAULTS})

        _STORE_PATH.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp_path = tempfile.mkstemp(dir=_STORE_PATH.parent, prefix=".settings-", suffix=".json")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                json.dump(current, f, indent=2)
            os.replace(tmp_path, _STORE_PATH)
        finally:
            if os.path.exists(tmp_path):
                os.remove(tmp_path)

        return current
