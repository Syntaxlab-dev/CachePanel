"""Read-only API tokens for third-party integrations (Home Assistant,
personal scripts, anything that wants to read CachePanel's data without a
full browser session/login -- Grafana already has /metrics for its own
scraping, this covers everything else).

A token is a high-entropy random string (secrets.token_urlsafe(32), ~256
bits), never stored in plaintext -- only a SHA-256 hash, the same way a
session cookie's signature or a webhook secret would be verified. This is
deliberately NOT bcrypt like auth_credentials_store.py's password hashes:
bcrypt's slowness exists to blunt dictionary/rainbow-table attacks against
a human-chosen, low-entropy password, which is not what this is. A
generated token is never memorized or reused elsewhere and already has
far more entropy than bcrypt's own defense is calibrated for -- hashing it
with a fast, unsalted SHA-256 is the correct tool (and the only practical
one anyway: verify_token() below needs to look a token up by its hash in
roughly constant time without iterating every stored token through
bcrypt's deliberately-slow comparison on every single API request).

Storage follows the same file+Postgres double pattern as
auth_credentials_store.py: /data/api_tokens.json, or the `api_tokens`
table when DATABASE_URL is set (see db.py).

Enforcement lives in auth_guard.py, which treats a request bearing a valid
token exactly like an authenticated "viewer" session (see role handling
there) -- there is no "admin token" concept in this feature: every API
token is read-only, unconditionally, forever. Token management itself
(/api/routers/api_tokens.py) is deliberately NOT reachable via a Bearer
token at all (only a real admin session) -- otherwise a leaked read-only
token could mint itself further tokens.
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

_STORE_PATH = Path(os.environ.get("API_TOKENS_PATH", "/data/api_tokens.json"))
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
    fd, tmp_path = tempfile.mkstemp(dir=_STORE_PATH.parent, prefix=".apitokens-", suffix=".json")
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
        "SELECT id, label, token_hash, created_date FROM api_tokens ORDER BY id"
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
    """Generates and stores a new token, returning the RAW value -- this is
    the only moment it ever exists outside the caller's own copy of it;
    only its hash is persisted from here on, exactly like GitHub/GitLab
    personal access tokens."""
    raw_token = secrets.token_urlsafe(32)
    token_hash = _hash_token(raw_token)
    created_date = datetime.now(timezone.utc).isoformat()
    with _lock:
        if db.is_enabled():
            with db.get_connection() as conn:
                conn.execute(
                    "INSERT INTO api_tokens (id, label, token_hash, created_date) VALUES "
                    "((SELECT COALESCE(MAX(id), 0) + 1 FROM api_tokens), %s, %s, %s)",
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
                conn.execute("DELETE FROM api_tokens WHERE id = %s", (token_id,))
            return
        tokens = _read_all_file()
        _write_all_file([t for t in tokens if t["id"] != token_id])


def verify_token(raw_token: str) -> bool:
    """True if raw_token matches any currently stored (hashed) token.
    Called on every incoming request that carries a Bearer header (see
    auth_guard.py), so this stays a cheap hash-and-compare, not a bcrypt
    verify -- see the module docstring for why that's the right choice
    here, not a shortcut."""
    if not raw_token:
        return False
    token_hash = _hash_token(raw_token)
    with _lock:
        if db.is_enabled():
            with db.get_connection() as conn:
                row = conn.execute(
                    "SELECT 1 FROM api_tokens WHERE token_hash = %s", (token_hash,)
                ).fetchone()
            return row is not None
        tokens = _read_all_file()
    return any(t["token_hash"] == token_hash for t in tokens)
