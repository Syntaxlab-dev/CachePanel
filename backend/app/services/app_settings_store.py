"""Persisted, user-editable settings (e.g. Steam credentials entered via the UI).

Kept separate from app.settings.Settings, which only holds deploy-time
infrastructure config (paths, container names) meant to be set once via
environment variables. Anything a user of CachePanel should be able to type
into the web UI itself (so nobody has to hand their own API keys to whoever
deployed the instance) lives here instead, encrypted at rest on disk.
See settings_encryption.py for the actual threat model this covers.
"""

import json
import os
import tempfile
from pathlib import Path
from threading import Lock

from app.services import settings_encryption

_STORE_PATH = Path(os.environ.get("APP_SETTINGS_PATH", "/data/settings.json"))
_lock = Lock()

_DEFAULTS = {
    "steam_api_key": "",
    "steam_id64": "",
}


def _read_raw() -> dict:
    if not _STORE_PATH.exists():
        return dict(_DEFAULTS)

    raw_bytes = _STORE_PATH.read_bytes()

    # Normal path: file is Fernet-encrypted JSON.
    try:
        data = json.loads(settings_encryption.decrypt(raw_bytes))
        merged = dict(_DEFAULTS)
        merged.update({k: v for k, v in data.items() if k in _DEFAULTS})
        return merged
    except settings_encryption.InvalidToken:
        pass
    except (json.JSONDecodeError, UnicodeDecodeError):
        pass

    # Migration path: an older CachePanel version wrote this file as plain
    # JSON. Read it once so the user doesn't lose settings they already
    # entered (e.g. via Steam login) -- the next write will re-save it
    # encrypted.
    try:
        data = json.loads(raw_bytes)
        merged = dict(_DEFAULTS)
        merged.update({k: v for k, v in data.items() if k in _DEFAULTS})
        return merged
    except (json.JSONDecodeError, UnicodeDecodeError):
        pass

    # File exists but isn't readable in either format (corrupt, wrong key,
    # etc.) -- fail soft rather than crash the app on startup.
    return dict(_DEFAULTS)


def get_settings() -> dict:
    with _lock:
        return _read_raw()


def update_settings(partial: dict) -> dict:
    with _lock:
        current = _read_raw()
        current.update({k: v for k, v in partial.items() if k in _DEFAULTS})

        _STORE_PATH.parent.mkdir(parents=True, exist_ok=True)
        encrypted = settings_encryption.encrypt(json.dumps(current).encode("utf-8"))

        fd, tmp_path = tempfile.mkstemp(dir=_STORE_PATH.parent, prefix=".settings-", suffix=".json")
        try:
            with os.fdopen(fd, "wb") as f:
                f.write(encrypted)
            os.chmod(tmp_path, 0o600)
            os.replace(tmp_path, _STORE_PATH)
        finally:
            if os.path.exists(tmp_path):
                os.remove(tmp_path)

        return current
