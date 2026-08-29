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

from app.services import db, settings_encryption

_STORE_PATH = Path(os.environ.get("APP_SETTINGS_PATH", "/data/settings.json"))
_lock = Lock()

_DEFAULTS = {
    "steam_api_key": "",
    "steam_id64": "",
    "steamgriddb_api_key": "",
    "discord_webhook_url": "",
    "discord_notify_success": True,
    "discord_notify_failure": True,
    "discord_notify_disk_warning": True,
    "run_history_limit": 50,
}


def _read_raw_file() -> dict:
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


def _read_raw_db() -> dict:
    with db.get_connection() as conn:
        row = conn.execute("SELECT encrypted_blob FROM app_settings WHERE id = 1").fetchone()

    if row is None:
        return dict(_DEFAULTS)

    # Same Fernet layer, same failure handling as the file path above --
    # only the byte source changed.
    try:
        data = json.loads(settings_encryption.decrypt(bytes(row[0])))
        merged = dict(_DEFAULTS)
        merged.update({k: v for k, v in data.items() if k in _DEFAULTS})
        return merged
    except (settings_encryption.InvalidToken, json.JSONDecodeError, UnicodeDecodeError):
        return dict(_DEFAULTS)


def _read_raw() -> dict:
    return _read_raw_db() if db.is_enabled() else _read_raw_file()


def get_settings() -> dict:
    with _lock:
        return _read_raw()


def get_encrypted_blob() -> bytes:
    """Raw Fernet-encrypted bytes exactly as stored, for the full-backup
    feature (routers/backup.py). Deliberately does NOT go through
    get_settings()'s decrypt step -- settings_encryption.py's own docstring
    names "it ends up in a misconfigured backup" as precisely the leak
    scenario the encryption defends against, so a backup feature handing
    back plaintext secrets would quietly defeat that. This only matters
    together with this host's .encryption_key, which a backup deliberately
    does not include -- restoring it elsewhere fails closed (falls back to
    defaults via the existing InvalidToken handling in _read_raw_file()/
    _read_raw_db()), it doesn't raise or leak anything."""
    with _lock:
        if db.is_enabled():
            with db.get_connection() as conn:
                row = conn.execute("SELECT encrypted_blob FROM app_settings WHERE id = 1").fetchone()
            if row is not None:
                return bytes(row[0])
        elif _STORE_PATH.exists():
            return _STORE_PATH.read_bytes()
    return settings_encryption.encrypt(json.dumps(dict(_DEFAULTS)).encode("utf-8"))


def restore_encrypted_blob(blob: bytes) -> None:
    """Writes a raw Fernet-encrypted blob directly (full-backup restore),
    bypassing update_settings()'s read-merge-encrypt cycle entirely -- the
    whole point is to never decrypt/re-encrypt the secrets it contains."""
    with _lock:
        if db.is_enabled():
            with db.get_connection() as conn:
                conn.execute(
                    "INSERT INTO app_settings (id, encrypted_blob) VALUES (1, %s) "
                    "ON CONFLICT (id) DO UPDATE SET encrypted_blob = EXCLUDED.encrypted_blob",
                    (blob,),
                )
            return

        _STORE_PATH.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp_path = tempfile.mkstemp(dir=_STORE_PATH.parent, prefix=".settings-", suffix=".json")
        try:
            with os.fdopen(fd, "wb") as f:
                f.write(blob)
            os.chmod(tmp_path, 0o600)
            os.replace(tmp_path, _STORE_PATH)
        finally:
            if os.path.exists(tmp_path):
                os.remove(tmp_path)


def update_settings(partial: dict) -> dict:
    with _lock:
        current = _read_raw()
        current.update({k: v for k, v in partial.items() if k in _DEFAULTS})

        # Same Fernet-encrypted blob either way -- only where it's stored
        # (file vs. a BYTEA column) differs below.
        encrypted = settings_encryption.encrypt(json.dumps(current).encode("utf-8"))

        if db.is_enabled():
            with db.get_connection() as conn:
                conn.execute(
                    "INSERT INTO app_settings (id, encrypted_blob) VALUES (1, %s) "
                    "ON CONFLICT (id) DO UPDATE SET encrypted_blob = EXCLUDED.encrypted_blob",
                    (encrypted,),
                )
            return current

        _STORE_PATH.parent.mkdir(parents=True, exist_ok=True)
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
