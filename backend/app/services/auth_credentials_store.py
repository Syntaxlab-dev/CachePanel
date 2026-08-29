"""Stores the single username/password credential that protects the
CachePanel UI itself (separate from the per-user Steam credentials in
app_settings_store.py, and separate from Steam's own OpenID login -- this
is purely "who is allowed to open this panel at all").

No Fernet encryption layer here unlike app_settings_store.py: a bcrypt
hash is already designed to be safe to store/expose as-is (one-way, salted,
deliberately slow to brute-force) -- wrapping it in Fernet on top wouldn't
add meaningful protection, just complexity. Same reasoning applies whether
this ends up in auth.json or the `auth` table (see db.py) -- the hash
itself is the protection, not the storage medium.
"""

import json
import os
import tempfile
from pathlib import Path
from threading import Lock

import bcrypt

from app.services import db

_STORE_PATH = Path(os.environ.get("AUTH_CREDENTIALS_PATH", "/data/auth.json"))
_lock = Lock()


def is_configured() -> bool:
    with _lock:
        if db.is_enabled():
            with db.get_connection() as conn:
                row = conn.execute("SELECT 1 FROM auth WHERE id = 1").fetchone()
            return row is not None
        return _STORE_PATH.exists()


def set_credentials(username: str, password: str) -> None:
    """Sets the panel credentials. Callers must ensure this is only ever
    invoked when no credentials exist yet (first-run setup) or when the
    caller has already authenticated (changing credentials later) -- this
    function itself doesn't check, it just writes."""
    password_hash = bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")

    with _lock:
        if db.is_enabled():
            with db.get_connection() as conn:
                conn.execute(
                    "INSERT INTO auth (id, username, password_hash) VALUES (1, %s, %s) "
                    "ON CONFLICT (id) DO UPDATE SET username = EXCLUDED.username, "
                    "password_hash = EXCLUDED.password_hash",
                    (username, password_hash),
                )
            return

        data = {"username": username, "password_hash": password_hash}
        _STORE_PATH.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp_path = tempfile.mkstemp(dir=_STORE_PATH.parent, prefix=".auth-", suffix=".json")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                json.dump(data, f)
            os.chmod(tmp_path, 0o600)
            os.replace(tmp_path, _STORE_PATH)
        finally:
            if os.path.exists(tmp_path):
                os.remove(tmp_path)


def verify_credentials(username: str, password: str) -> bool:
    with _lock:
        if db.is_enabled():
            with db.get_connection() as conn:
                row = conn.execute("SELECT username, password_hash FROM auth WHERE id = 1").fetchone()
            if row is None:
                return False
            data = {"username": row[0], "password_hash": row[1]}
        else:
            if not _STORE_PATH.exists():
                return False
            try:
                data = json.loads(_STORE_PATH.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, UnicodeDecodeError, OSError):
                return False

    if data.get("username") != username:
        return False
    stored_hash = data.get("password_hash", "")
    if not stored_hash:
        return False
    try:
        return bcrypt.checkpw(password.encode("utf-8"), stored_hash.encode("utf-8"))
    except ValueError:
        # Malformed hash on disk/in DB -- treat as "doesn't match" rather than 500.
        return False
