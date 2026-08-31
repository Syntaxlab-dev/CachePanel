"""Registry of remote CachePanel instances this instance controls as their
"master" (4th feature round, Welle 4) -- CubeCoders-AMP-style: each entry
is a name + base URL + the INSTANCE token that remote instance generated
for itself (see instance_token_store.py), pasted in here by an admin.

The instance token is stored encrypted at rest using the exact same Fernet
mechanism as app_settings_store.py's secrets (steam_api_key etc.) -- see
settings_encryption.py for the threat model that buys. Unlike
app_settings_store.py, this isn't a single settings blob but a list of
rows (an admin can register any number of slaves), so each row gets its
own encrypted_token column/field rather than reusing the one-row settings
table.

SSRF note, considered and accepted: this feature makes the server issue
outgoing HTTP requests to a URL an admin types in, which is the textbook
shape of an SSRF risk. It's accepted here for the same reason
discord_webhook_url / ntfy_server_url already are (see discord_notifier.py,
ntfy_notifier.py): the URL is admin-only input on an already-trusted admin
session, not attacker-controlled data flowing in from an untrusted source,
and the whole point of a self-hosted admin panel's own "master-slave"
feature is that an admin gets to point it at wherever they run their other
instances -- including internal-only addresses, which is the expected
common case (see remote_instance_client.py's own docstring on HTTP vs.
HTTPS between instances).
"""

import json
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock

from app.services import db, settings_encryption

_STORE_PATH = Path(os.environ.get("SLAVE_INSTANCES_PATH", "/data/slave_instances.json"))
_lock = Lock()


def _read_all_file() -> list[dict]:
    if not _STORE_PATH.exists():
        return []
    try:
        data = json.loads(_STORE_PATH.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError, OSError):
        return []
    if isinstance(data, dict) and "instances" in data:
        return [
            i
            for i in data["instances"]
            if isinstance(i, dict) and {"id", "name", "base_url", "encrypted_token", "created_date"} <= i.keys()
        ]
    return []


def _write_all_file(instances: list[dict]) -> None:
    _STORE_PATH.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(dir=_STORE_PATH.parent, prefix=".slaveinstances-", suffix=".json")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            # encrypted_token is stored base64-ish (Fernet output is URL-safe
            # base64 bytes) -- decode to str for JSON, matches the pattern of
            # storing Fernet ciphertext as text rather than raw bytes when
            # the container is JSON, not a BYTEA column.
            json.dump(
                {
                    "instances": [
                        {**i, "encrypted_token": i["encrypted_token"].decode("ascii") if isinstance(i["encrypted_token"], bytes) else i["encrypted_token"]}
                        for i in instances
                    ]
                },
                f,
            )
        os.chmod(tmp_path, 0o600)
        os.replace(tmp_path, _STORE_PATH)
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)


def _read_all_db(conn) -> list[dict]:
    rows = conn.execute(
        "SELECT id, name, base_url, encrypted_token, created_date FROM slave_instances ORDER BY id"
    ).fetchall()
    return [
        {"id": r[0], "name": r[1], "base_url": r[2], "encrypted_token": bytes(r[3]), "created_date": r[4]}
        for r in rows
    ]


def list_instances() -> list[dict]:
    """id, name, base_url, created_date only -- never the token, encrypted
    or otherwise. Mirrors api_token_store.list_tokens()'s own contract."""
    with _lock:
        if db.is_enabled():
            with db.get_connection() as conn:
                instances = _read_all_db(conn)
        else:
            instances = _read_all_file()
    return [{"id": i["id"], "name": i["name"], "base_url": i["base_url"], "created_date": i["created_date"]} for i in instances]


def get_instance(instance_id: int) -> dict | None:
    """Full record INCLUDING the decrypted token -- for internal use by
    remote_instance_client.py only, never returned from a router directly."""
    with _lock:
        if db.is_enabled():
            with db.get_connection() as conn:
                row = conn.execute(
                    "SELECT id, name, base_url, encrypted_token, created_date FROM slave_instances WHERE id = %s",
                    (instance_id,),
                ).fetchone()
            if row is None:
                return None
            encrypted_token = bytes(row[3])
            record = {"id": row[0], "name": row[1], "base_url": row[2], "created_date": row[4]}
        else:
            instances = _read_all_file()
            match = next((i for i in instances if i["id"] == instance_id), None)
            if match is None:
                return None
            raw_enc = match["encrypted_token"]
            encrypted_token = raw_enc.encode("ascii") if isinstance(raw_enc, str) else raw_enc
            record = {"id": match["id"], "name": match["name"], "base_url": match["base_url"], "created_date": match["created_date"]}

    try:
        record["token"] = settings_encryption.decrypt(encrypted_token).decode("utf-8")
    except settings_encryption.InvalidToken:
        # Same fail-soft contract as app_settings_store.py's own decrypt
        # paths: a corrupt/foreign-key blob shouldn't crash the request,
        # just make this instance unreachable until re-added.
        record["token"] = None
    return record


def add_instance(name: str, base_url: str, raw_token: str) -> int:
    encrypted_token = settings_encryption.encrypt(raw_token.encode("utf-8"))
    created_date = datetime.now(timezone.utc).isoformat()
    with _lock:
        if db.is_enabled():
            with db.get_connection() as conn:
                row = conn.execute(
                    "INSERT INTO slave_instances (id, name, base_url, encrypted_token, created_date) VALUES "
                    "((SELECT COALESCE(MAX(id), 0) + 1 FROM slave_instances), %s, %s, %s, %s) RETURNING id",
                    (name, base_url, encrypted_token, created_date),
                ).fetchone()
            return row[0]

        instances = _read_all_file()
        next_id = max((i["id"] for i in instances), default=0) + 1
        instances.append(
            {"id": next_id, "name": name, "base_url": base_url, "encrypted_token": encrypted_token, "created_date": created_date}
        )
        _write_all_file(instances)
        return next_id


def delete_instance(instance_id: int) -> None:
    with _lock:
        if db.is_enabled():
            with db.get_connection() as conn:
                conn.execute("DELETE FROM slave_instances WHERE id = %s", (instance_id,))
            return
        instances = _read_all_file()
        _write_all_file([i for i in instances if i["id"] != instance_id])
