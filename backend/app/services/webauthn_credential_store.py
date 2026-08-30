"""Passkey/WebAuthn credentials (4th feature round, Welle 2) -- see
routers/auth.py's /webauthn/* endpoints and webauthn_service.py for the
actual registration/authentication cryptography, which this module has
nothing to do with; it only persists the already-verified result.

credential_id and public_key are stored base64url-encoded TEXT rather than
raw bytes, purely so both storage backends (file JSON / Postgres) use the
exact same string representation -- JSON has no native bytes type anyway,
and this avoids a bytes<->str conversion split between the two backends.
Same file+Postgres double pattern as api_token_store.py, keyed by
credential_id (globally unique per the WebAuthn spec, not per-user) rather
than an auto-increment id, since every lookup this module needs
(sign_count update on login, delete from Settings) already has the
credential_id in hand.

Multiple credentials per username are expected and supported (a phone, a
hardware key, a laptop's platform authenticator) -- list_for_user() is a
plain filter, not a single-row-per-user lookup.
"""

import json
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock

from app.services import db

_STORE_PATH = Path(os.environ.get("WEBAUTHN_CREDENTIALS_PATH", "/data/webauthn_credentials.json"))
_lock = Lock()


def _read_all_file() -> list[dict]:
    if not _STORE_PATH.exists():
        return []
    try:
        data = json.loads(_STORE_PATH.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError, OSError):
        return []
    if not isinstance(data, dict) or "credentials" not in data:
        return []
    required = {"credential_id", "username", "public_key", "sign_count", "rp_id", "label", "created_date"}
    return [c for c in data["credentials"] if isinstance(c, dict) and required.issubset(c)]


def _write_all_file(credentials: list[dict]) -> None:
    _STORE_PATH.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(dir=_STORE_PATH.parent, prefix=".webauthn-", suffix=".json")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump({"credentials": credentials}, f)
        os.chmod(tmp_path, 0o600)
        os.replace(tmp_path, _STORE_PATH)
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)


def _read_all_db(conn) -> list[dict]:
    rows = conn.execute(
        "SELECT credential_id, username, public_key, sign_count, rp_id, label, created_date "
        "FROM webauthn_credentials"
    ).fetchall()
    return [
        {
            "credential_id": r[0],
            "username": r[1],
            "public_key": r[2],
            "sign_count": r[3],
            "rp_id": r[4],
            "label": r[5],
            "created_date": r[6],
        }
        for r in rows
    ]


def list_for_user(username: str) -> list[dict]:
    """label/rp_id/created_date only shape is the caller's job to enforce
    (routers/auth.py never returns public_key/sign_count to the frontend);
    this returns the full record since get_by_credential_id() below reuses
    the same row shape for the actual login-verification path."""
    with _lock:
        if db.is_enabled():
            with db.get_connection() as conn:
                creds = _read_all_db(conn)
        else:
            creds = _read_all_file()
    return [c for c in creds if c["username"] == username]


def get_by_credential_id(credential_id: str) -> dict | None:
    with _lock:
        if db.is_enabled():
            with db.get_connection() as conn:
                row = conn.execute(
                    "SELECT credential_id, username, public_key, sign_count, rp_id, label, created_date "
                    "FROM webauthn_credentials WHERE credential_id = %s",
                    (credential_id,),
                ).fetchone()
            if row is None:
                return None
            return {
                "credential_id": row[0],
                "username": row[1],
                "public_key": row[2],
                "sign_count": row[3],
                "rp_id": row[4],
                "label": row[5],
                "created_date": row[6],
            }
        creds = _read_all_file()
    return next((c for c in creds if c["credential_id"] == credential_id), None)


def add(credential_id: str, username: str, public_key: str, sign_count: int, rp_id: str, label: str) -> None:
    created_date = datetime.now(timezone.utc).isoformat()
    with _lock:
        if db.is_enabled():
            with db.get_connection() as conn:
                conn.execute(
                    "INSERT INTO webauthn_credentials "
                    "(credential_id, username, public_key, sign_count, rp_id, label, created_date) "
                    "VALUES (%s, %s, %s, %s, %s, %s, %s)",
                    (credential_id, username, public_key, sign_count, rp_id, label, created_date),
                )
            return
        creds = _read_all_file()
        creds.append(
            {
                "credential_id": credential_id,
                "username": username,
                "public_key": public_key,
                "sign_count": sign_count,
                "rp_id": rp_id,
                "label": label,
                "created_date": created_date,
            }
        )
        _write_all_file(creds)


def update_sign_count(credential_id: str, sign_count: int) -> None:
    """Called after every successful passkey login (see routers/auth.py) --
    the whole point of tracking sign_count is to detect a cloned
    authenticator: a legitimate device's counter only ever increases, so a
    replayed/cloned assertion carrying a stale-or-equal count is rejected
    by webauthn_service.py's verification step before this is ever
    reached."""
    with _lock:
        if db.is_enabled():
            with db.get_connection() as conn:
                conn.execute(
                    "UPDATE webauthn_credentials SET sign_count = %s WHERE credential_id = %s",
                    (sign_count, credential_id),
                )
            return
        creds = _read_all_file()
        for c in creds:
            if c["credential_id"] == credential_id:
                c["sign_count"] = sign_count
        _write_all_file(creds)


def delete(credential_id: str, username: str) -> bool:
    """Scoped to `username` so one account can never revoke another
    account's passkey by guessing/enumerating credential ids -- same
    reasoning as session_registry_store.revoke()."""
    with _lock:
        if db.is_enabled():
            with db.get_connection() as conn:
                result = conn.execute(
                    "DELETE FROM webauthn_credentials WHERE credential_id = %s AND username = %s",
                    (credential_id, username),
                )
            return result.rowcount > 0
        creds = _read_all_file()
        remaining = [c for c in creds if not (c["credential_id"] == credential_id and c["username"] == username)]
        if len(remaining) == len(creds):
            return False
        _write_all_file(remaining)
        return True
