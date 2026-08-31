"""Write-scoped tokens for the master-slave instance system (4th feature
round, Welle 4) -- a CachePanel instance generates these for ITSELF (the
"slave" side) so that a *different* CachePanel instance (the "master") can
be handed the raw value and use it to remote-control this one.

Deliberately a SEPARATE store from api_token_store.py, not an extension of
it, even though the storage mechanics (random token, only its hash
persisted, file+Postgres dual pattern) are nearly identical. The two token
types must never be interchangeable: an API token is unconditionally
read-only forever (see api_token_store.py's own docstring), while an
instance token is meant to actually trigger a prefill run on this
instance -- a real, if narrow, write capability. Keeping them in separate
stores/tables means a bug that confused the two lookup paths would fail
closed (token not found in the wrong store) rather than accidentally
granting write access to what was meant to be a read-only integration
token, or vice versa.

Every instance token carries the SAME fixed scope -- read-only status plus
prefill-trigger, nothing else -- there is no per-token scope configuration.
auth_guard.py enforces that scope via a small allowlist of exact paths,
NOT by treating an instance token like a broadened "viewer" session (a
viewer/API-token can GET almost anything; an instance token must not be
able to read e.g. GET /api/settings, which returns decrypted secrets).

The raw token is prefixed with TOKEN_PREFIX so auth_guard.py can route an
incoming Bearer header to this store's lookup vs. api_token_store.py's
WITHOUT needing to try both on every single request -- a request whose
token doesn't start with this prefix is never even hashed against this
store. This is a routing optimization, not a security boundary: even
without the prefix, a token created by one store could never coincidentally
hash-match an entry in the other (a 256-bit random token colliding by
chance is not a real-world risk).
"""

import hashlib
import json
import os
import secrets
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock

from app.services import db

TOKEN_PREFIX = "cpit_"

_STORE_PATH = Path(os.environ.get("INSTANCE_TOKENS_PATH", "/data/instance_tokens.json"))
_lock = Lock()


def _hash_token(raw_token: str) -> str:
    return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()


def _read_all_file() -> list[dict]:
    if not _STORE_PATH.exists():
        return []
    try:
        data = json.loads(_STORE_PATH.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError, OSError):
        return []
    if isinstance(data, dict) and "tokens" in data:
        return [
            t
            for t in data["tokens"]
            if isinstance(t, dict) and "id" in t and "label" in t and "token_hash" in t
        ]
    return []


def _write_all_file(tokens: list[dict]) -> None:
    _STORE_PATH.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(dir=_STORE_PATH.parent, prefix=".instancetokens-", suffix=".json")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump({"tokens": tokens}, f)
        os.chmod(tmp_path, 0o600)
        os.replace(tmp_path, _STORE_PATH)
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)


def _read_all_db(conn) -> list[dict]:
    rows = conn.execute(
        "SELECT id, label, token_hash, created_date FROM instance_tokens ORDER BY id"
    ).fetchall()
    return [{"id": r[0], "label": r[1], "token_hash": r[2], "created_date": r[3]} for r in rows]


def list_tokens() -> list[dict]:
    """id + label + created_date only -- never the hash, and the raw token
    itself was never stored anywhere past the moment create_token()
    returned it."""
    with _lock:
        if db.is_enabled():
            with db.get_connection() as conn:
                tokens = _read_all_db(conn)
        else:
            tokens = _read_all_file()
    return [{"id": t["id"], "label": t["label"], "created_date": t["created_date"]} for t in tokens]


def create_token(label: str) -> str:
    """Generates and stores a new instance token, returning the RAW,
    prefixed value -- this is the only moment it ever exists outside the
    caller's own copy of it (which is expected to be pasted into a
    DIFFERENT CachePanel instance's "add slave" form); only its hash is
    persisted from here on."""
    raw_token = TOKEN_PREFIX + secrets.token_urlsafe(32)
    token_hash = _hash_token(raw_token)
    created_date = datetime.now(timezone.utc).isoformat()
    with _lock:
        if db.is_enabled():
            with db.get_connection() as conn:
                conn.execute(
                    "INSERT INTO instance_tokens (id, label, token_hash, created_date) VALUES "
                    "((SELECT COALESCE(MAX(id), 0) + 1 FROM instance_tokens), %s, %s, %s)",
                    (label, token_hash, created_date),
                )
            return raw_token

        tokens = _read_all_file()
        next_id = max((t["id"] for t in tokens), default=0) + 1
        tokens.append({"id": next_id, "label": label, "token_hash": token_hash, "created_date": created_date})
        _write_all_file(tokens)
    return raw_token


def delete_token(token_id: int) -> None:
    with _lock:
        if db.is_enabled():
            with db.get_connection() as conn:
                conn.execute("DELETE FROM instance_tokens WHERE id = %s", (token_id,))
            return
        tokens = _read_all_file()
        _write_all_file([t for t in tokens if t["id"] != token_id])


def identify_token(raw_token: str) -> int | None:
    """Returns the matching instance token's id, or None. Callers (see
    auth_guard.py) are expected to have already checked the TOKEN_PREFIX
    before calling this, but this function itself doesn't require it --
    a token without the prefix simply won't be found, same as any other
    unknown value."""
    if not raw_token:
        return None
    with _lock:
        if db.is_enabled():
            with db.get_connection() as conn:
                row = conn.execute(
                    "SELECT id FROM instance_tokens WHERE token_hash = %s", (_hash_token(raw_token),)
                ).fetchone()
            return row[0] if row is not None else None
        tokens = _read_all_file()
    match = next((t for t in tokens if t["token_hash"] == _hash_token(raw_token)), None)
    return match["id"] if match else None
