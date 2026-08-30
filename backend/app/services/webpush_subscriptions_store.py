"""Stores browser Push API subscriptions (one per device/browser that
enabled web push in Settings), keyed on the subscription's own `endpoint`
URL -- that's already unique per browser+origin per the Push API spec, so
subscribing again from the same browser (e.g. after clearing site data)
naturally overwrites its old entry instead of accumulating duplicates.

Not sensitive data (an endpoint + the browser's own public encryption
keys, not a secret CachePanel controls), so this stays a plain file+
Postgres double pattern like client_labels_store.py, no Fernet layer.

The subscription dict stored here is exactly what the browser's
PushSubscription.toJSON() produces client-side -- passed back to it
unmodified as pywebpush.webpush()'s `subscription_info` argument, so this
store never needs to know its internal shape beyond "it's a dict with an
`endpoint` key".
"""

import json
import os
import tempfile
from pathlib import Path
from threading import Lock

from app.services import db

_STORE_PATH = Path(os.environ.get("WEBPUSH_SUBSCRIPTIONS_PATH", "/data/webpush_subscriptions.json"))
_lock = Lock()


def _read_all_file() -> list[dict]:
    if not _STORE_PATH.exists():
        return []
    try:
        data = json.loads(_STORE_PATH.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError, OSError):
        return []
    if not isinstance(data, dict) or not isinstance(data.get("subscriptions"), list):
        return []
    return [s for s in data["subscriptions"] if isinstance(s, dict) and "endpoint" in s]


def _write_all_file(subscriptions: list[dict]) -> None:
    _STORE_PATH.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(dir=_STORE_PATH.parent, prefix=".webpush-subs-", suffix=".json")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump({"subscriptions": subscriptions}, f)
        os.chmod(tmp_path, 0o600)
        os.replace(tmp_path, _STORE_PATH)
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)


def list_subscriptions() -> list[dict]:
    """Every stored subscription_info dict, ready to hand to
    pywebpush.webpush() one at a time -- see webpush_notifier.py."""
    with _lock:
        if db.is_enabled():
            with db.get_connection() as conn:
                rows = conn.execute("SELECT subscription_json FROM webpush_subscriptions").fetchall()
            return [json.loads(r[0]) for r in rows]
        return _read_all_file()


def add_subscription(subscription: dict) -> None:
    endpoint = subscription.get("endpoint")
    if not endpoint:
        raise ValueError("subscription is missing 'endpoint'")
    with _lock:
        if db.is_enabled():
            with db.get_connection() as conn:
                conn.execute(
                    "INSERT INTO webpush_subscriptions (endpoint, subscription_json) VALUES (%s, %s) "
                    "ON CONFLICT (endpoint) DO UPDATE SET subscription_json = EXCLUDED.subscription_json",
                    (endpoint, json.dumps(subscription)),
                )
            return

        subs = [s for s in _read_all_file() if s["endpoint"] != endpoint]
        subs.append(subscription)
        _write_all_file(subs)


def remove_subscription(endpoint: str) -> None:
    with _lock:
        if db.is_enabled():
            with db.get_connection() as conn:
                conn.execute("DELETE FROM webpush_subscriptions WHERE endpoint = %s", (endpoint,))
            return

        subs = [s for s in _read_all_file() if s["endpoint"] != endpoint]
        _write_all_file(subs)
