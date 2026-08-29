"""Stores the username/password credentials that protect the CachePanel UI
itself (separate from the per-user Steam credentials in
app_settings_store.py, and separate from Steam's own OpenID login -- this
is purely "who is allowed to open this panel at all").

Multi-user since Welle 4: any of the stored accounts can log in, and
Settings lets an already-authenticated user add or remove others. At least
one account must always remain -- remove_user() enforces that so a panel
can never lock itself out entirely.

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


def _read_all_file() -> list[dict]:
    if not _STORE_PATH.exists():
        return []
    try:
        data = json.loads(_STORE_PATH.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError, OSError):
        return []

    # Migration path: pre-Welle-4 files hold a single {"username",
    # "password_hash"} object rather than {"users": [...]}. Read it once so
    # the existing production account survives the upgrade -- the next
    # write (_write_all_file) re-saves it in the new shape.
    if isinstance(data, dict) and "users" in data:
        return [u for u in data["users"] if isinstance(u, dict) and "username" in u and "password_hash" in u]
    if isinstance(data, dict) and "username" in data and "password_hash" in data:
        return [{"username": data["username"], "password_hash": data["password_hash"]}]
    return []


def _write_all_file(users: list[dict]) -> None:
    _STORE_PATH.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(dir=_STORE_PATH.parent, prefix=".auth-", suffix=".json")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump({"users": users}, f)
        os.chmod(tmp_path, 0o600)
        os.replace(tmp_path, _STORE_PATH)
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)


def _read_all_db(conn) -> list[dict]:
    rows = conn.execute("SELECT username, password_hash FROM auth ORDER BY id").fetchall()
    return [{"username": r[0], "password_hash": r[1]} for r in rows]


def is_configured() -> bool:
    with _lock:
        if db.is_enabled():
            with db.get_connection() as conn:
                row = conn.execute("SELECT 1 FROM auth LIMIT 1").fetchone()
            return row is not None
        return len(_read_all_file()) > 0


def list_users() -> list[dict]:
    """Usernames only, no password hashes -- for the "manage users" UI in
    Settings, which has no business seeing hashes at all."""
    with _lock:
        if db.is_enabled():
            with db.get_connection() as conn:
                users = _read_all_db(conn)
        else:
            users = _read_all_file()
    return [{"username": u["username"]} for u in users]


def get_credentials() -> list[dict]:
    """Returns every {"username", "password_hash"} pair. Used by the
    full-backup feature -- bcrypt hashes are safe to include in a backup
    file as-is (see module docstring: the hash itself is the protection,
    not the storage medium), so this is a plain read, no extra encryption
    layer to add here."""
    with _lock:
        if db.is_enabled():
            with db.get_connection() as conn:
                return _read_all_db(conn)
        return _read_all_file()


def set_credentials(username: str, password: str) -> None:
    """First-run only: creates the very first account. Callers must ensure
    this is only invoked when no credentials exist yet -- this function
    itself doesn't check (see routers/auth.py's /setup, which does)."""
    password_hash = bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
    with _lock:
        if db.is_enabled():
            with db.get_connection() as conn:
                conn.execute(
                    "INSERT INTO auth (id, username, password_hash) VALUES "
                    "((SELECT COALESCE(MAX(id), 0) + 1 FROM auth), %s, %s)",
                    (username, password_hash),
                )
            return
        _write_all_file([{"username": username, "password_hash": password_hash}])


def add_user(username: str, password: str) -> None:
    """Adds an additional panel account. Raises ValueError if the username
    is already taken (case-sensitive, same as verify_credentials)."""
    password_hash = bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
    with _lock:
        if db.is_enabled():
            with db.get_connection() as conn:
                existing = conn.execute("SELECT 1 FROM auth WHERE username = %s", (username,)).fetchone()
                if existing:
                    raise ValueError("username_taken")
                conn.execute(
                    "INSERT INTO auth (id, username, password_hash) VALUES "
                    "((SELECT COALESCE(MAX(id), 0) + 1 FROM auth), %s, %s)",
                    (username, password_hash),
                )
            return

        users = _read_all_file()
        if any(u["username"] == username for u in users):
            raise ValueError("username_taken")
        users.append({"username": username, "password_hash": password_hash})
        _write_all_file(users)


def remove_user(username: str) -> None:
    """Removes one account. Raises ValueError if the account doesn't exist,
    or if it's the last remaining one -- a panel must always keep at least
    one account, otherwise nobody could ever log back in."""
    with _lock:
        if db.is_enabled():
            with db.get_connection() as conn:
                users = _read_all_db(conn)
                if not any(u["username"] == username for u in users):
                    raise ValueError("not_found")
                if len(users) <= 1:
                    raise ValueError("last_user")
                conn.execute("DELETE FROM auth WHERE username = %s", (username,))
            return

        users = _read_all_file()
        if not any(u["username"] == username for u in users):
            raise ValueError("not_found")
        if len(users) <= 1:
            raise ValueError("last_user")
        _write_all_file([u for u in users if u["username"] != username])


def restore_credentials(users: list[dict]) -> None:
    """Replaces every account with the given list -- used by the
    full-backup restore, which carries bcrypt hashes themselves (see
    get_credentials()), never plaintext passwords. Doesn't re-hash them
    (that would hash the hash, breaking every future login). A backup
    taken pre-Welle-4 (single {"username","password_hash"} dict, not a
    list) is normalized to a one-item list by backup.py before this is
    called."""
    with _lock:
        if db.is_enabled():
            with db.get_connection() as conn:
                conn.execute("DELETE FROM auth")
                for u in users:
                    conn.execute(
                        "INSERT INTO auth (id, username, password_hash) VALUES "
                        "((SELECT COALESCE(MAX(id), 0) + 1 FROM auth), %s, %s)",
                        (u["username"], u["password_hash"]),
                    )
            return
        _write_all_file([{"username": u["username"], "password_hash": u["password_hash"]} for u in users])


def verify_credentials(username: str, password: str) -> bool:
    users = get_credentials()
    match = next((u for u in users if u["username"] == username), None)
    if match is None:
        return False
    stored_hash = match.get("password_hash", "")
    if not stored_hash:
        return False
    try:
        return bcrypt.checkpw(password.encode("utf-8"), stored_hash.encode("utf-8"))
    except ValueError:
        # Malformed hash on disk/in DB -- treat as "doesn't match" rather than 500.
        return False
