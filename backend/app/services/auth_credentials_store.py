"""Stores the username/password credentials that protect the CachePanel UI
itself (separate from the per-user Steam credentials in
app_settings_store.py, and separate from Steam's own OpenID login -- this
is purely "who is allowed to open this panel at all").

Multi-user since Welle 4: any of the stored accounts can log in, and
Settings lets an already-authenticated user add or remove others. At least
one account must always remain -- remove_user() enforces that so a panel
can never lock itself out entirely.

Since the 3rd feature round each account also carries a `role`
("admin" | "viewer", see auth_guard.py for enforcement) and optional TOTP
two-factor fields (`totp_secret`, `totp_enabled`, see routers/auth.py's
/totp/* endpoints and the two-step login flow). Both are additive fields
on the same per-user record -- a pre-existing account read via the
migration paths below always comes back with role="admin" and
totp_enabled=False, so an upgrade can never downgrade or lock out an
account that already existed.

No Fernet encryption layer here unlike app_settings_store.py: a bcrypt
hash is already designed to be safe to store/expose as-is (one-way, salted,
deliberately slow to brute-force) -- wrapping it in Fernet on top wouldn't
add meaningful protection, just complexity. Same reasoning applies whether
this ends up in auth.json or the `auth` table (see db.py) -- the hash
itself is the protection, not the storage medium. A TOTP secret is a
shared symmetric key rather than a one-way hash, so in principle it's more
sensitive than a password hash -- but it grants nothing by itself without
also already having the matching password, and it lives in the exact same
trust boundary (this store, this host) as the password hash it's paired
with, so the same "not Fernet-wrapped" reasoning applies here too.
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

_VALID_ROLES = {"admin", "viewer"}


def _normalize(user: dict) -> dict:
    """Fills in defaults for fields that didn't exist before this feature
    round, so a record read from an older auth.json/DB row always comes
    back complete. role defaults to "admin" (never silently downgrade an
    existing account's privileges) and TOTP defaults to off (never
    silently require a second factor nobody set up)."""
    return {
        "username": user["username"],
        "password_hash": user["password_hash"],
        "role": user.get("role") if user.get("role") in _VALID_ROLES else "admin",
        "totp_secret": user.get("totp_secret"),
        "totp_enabled": bool(user.get("totp_enabled")),
    }


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
        return [
            _normalize(u) for u in data["users"] if isinstance(u, dict) and "username" in u and "password_hash" in u
        ]
    if isinstance(data, dict) and "username" in data and "password_hash" in data:
        return [_normalize(data)]
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
    rows = conn.execute(
        "SELECT username, password_hash, role, totp_secret, totp_enabled FROM auth ORDER BY id"
    ).fetchall()
    return [
        _normalize(
            {
                "username": r[0],
                "password_hash": r[1],
                "role": r[2],
                "totp_secret": r[3],
                "totp_enabled": r[4],
            }
        )
        for r in rows
    ]


def is_configured() -> bool:
    with _lock:
        if db.is_enabled():
            with db.get_connection() as conn:
                row = conn.execute("SELECT 1 FROM auth LIMIT 1").fetchone()
            return row is not None
        return len(_read_all_file()) > 0


def list_users() -> list[dict]:
    """Username + role only, no password hashes or TOTP secrets -- for the
    "manage users" UI in Settings, which has no business seeing either."""
    with _lock:
        if db.is_enabled():
            with db.get_connection() as conn:
                users = _read_all_db(conn)
        else:
            users = _read_all_file()
    return [{"username": u["username"], "role": u["role"]} for u in users]


def get_credentials() -> list[dict]:
    """Returns every full user record (including password_hash and TOTP
    fields). Used by the full-backup feature -- bcrypt hashes are safe to
    include in a backup file as-is (see module docstring), and a TOTP
    secret is no more sensitive than the password hash it's paired with in
    this same trust boundary, so this is a plain read, no extra encryption
    layer to add here."""
    with _lock:
        if db.is_enabled():
            with db.get_connection() as conn:
                return _read_all_db(conn)
        return _read_all_file()


def get_user(username: str) -> dict | None:
    """Full record for one user (login/TOTP flows) -- None if not found."""
    users = get_credentials()
    return next((u for u in users if u["username"] == username), None)


def set_credentials(username: str, password: str) -> None:
    """First-run only: creates the very first account. Always role="admin"
    -- a panel can never bootstrap into a state where the only account is
    read-only. Callers must ensure this is only invoked when no credentials
    exist yet -- this function itself doesn't check (see routers/auth.py's
    /setup, which does)."""
    password_hash = bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
    with _lock:
        if db.is_enabled():
            with db.get_connection() as conn:
                conn.execute(
                    "INSERT INTO auth (id, username, password_hash, role) VALUES "
                    "((SELECT COALESCE(MAX(id), 0) + 1 FROM auth), %s, %s, 'admin')",
                    (username, password_hash),
                )
            return
        _write_all_file([_normalize({"username": username, "password_hash": password_hash, "role": "admin"})])


def add_user(username: str, password: str, role: str = "admin") -> None:
    """Adds an additional panel account. Raises ValueError if the username
    is already taken (case-sensitive, same as verify_credentials). `role`
    defaults to "admin" for backward compatibility with any existing
    caller that doesn't pass it -- routers/users.py's endpoint always
    passes an explicit, validated role."""
    if role not in _VALID_ROLES:
        role = "admin"
    password_hash = bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
    with _lock:
        if db.is_enabled():
            with db.get_connection() as conn:
                existing = conn.execute("SELECT 1 FROM auth WHERE username = %s", (username,)).fetchone()
                if existing:
                    raise ValueError("username_taken")
                conn.execute(
                    "INSERT INTO auth (id, username, password_hash, role) VALUES "
                    "((SELECT COALESCE(MAX(id), 0) + 1 FROM auth), %s, %s, %s)",
                    (username, password_hash, role),
                )
            return

        users = _read_all_file()
        if any(u["username"] == username for u in users):
            raise ValueError("username_taken")
        users.append(_normalize({"username": username, "password_hash": password_hash, "role": role}))
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


def set_totp(username: str, secret: str) -> None:
    """Enables TOTP for an existing account and persists the (already
    verified by the caller -- see routers/auth.py's /totp/confirm) secret.
    Raises ValueError("not_found") if the account doesn't exist."""
    with _lock:
        if db.is_enabled():
            with db.get_connection() as conn:
                result = conn.execute(
                    "UPDATE auth SET totp_secret = %s, totp_enabled = TRUE WHERE username = %s",
                    (secret, username),
                )
                if result.rowcount == 0:
                    raise ValueError("not_found")
            return

        users = _read_all_file()
        if not any(u["username"] == username for u in users):
            raise ValueError("not_found")
        for u in users:
            if u["username"] == username:
                u["totp_secret"] = secret
                u["totp_enabled"] = True
        _write_all_file(users)


def disable_totp(username: str) -> None:
    """Raises ValueError("not_found") if the account doesn't exist."""
    with _lock:
        if db.is_enabled():
            with db.get_connection() as conn:
                result = conn.execute(
                    "UPDATE auth SET totp_secret = NULL, totp_enabled = FALSE WHERE username = %s",
                    (username,),
                )
                if result.rowcount == 0:
                    raise ValueError("not_found")
            return

        users = _read_all_file()
        if not any(u["username"] == username for u in users):
            raise ValueError("not_found")
        for u in users:
            if u["username"] == username:
                u["totp_secret"] = None
                u["totp_enabled"] = False
        _write_all_file(users)


def restore_credentials(users: list[dict]) -> None:
    """Replaces every account with the given list -- used by the
    full-backup restore, which carries bcrypt hashes themselves (see
    get_credentials()), never plaintext passwords. Doesn't re-hash them
    (that would hash the hash, breaking every future login). A backup
    taken pre-Welle-4 (single {"username","password_hash"} dict, not a
    list) is normalized to a one-item list by backup.py before this is
    called. A backup taken before this feature round has no role/TOTP
    fields at all -- _normalize() fills those in with the same safe
    defaults (role="admin", TOTP off) as every other migration path here."""
    normalized = [_normalize(u) for u in users]
    with _lock:
        if db.is_enabled():
            with db.get_connection() as conn:
                conn.execute("DELETE FROM auth")
                for u in normalized:
                    conn.execute(
                        "INSERT INTO auth (id, username, password_hash, role, totp_secret, totp_enabled) VALUES "
                        "((SELECT COALESCE(MAX(id), 0) + 1 FROM auth), %s, %s, %s, %s, %s)",
                        (u["username"], u["password_hash"], u["role"], u["totp_secret"], u["totp_enabled"]),
                    )
            return
        _write_all_file(normalized)


def verify_credentials(username: str, password: str) -> bool:
    match = get_user(username)
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
