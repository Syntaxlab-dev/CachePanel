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
    # Weekly cache-summary report (see cache_report.py/scheduler_service.py's
    # report job) -- weekday follows APScheduler's CronTrigger convention,
    # 0=Monday..6=Sunday.
    "report_enabled": False,
    "report_weekday": 0,
    "report_hour": 9,
    "report_minute": 0,
    # LAN-party display (routers/public_display.py) -- off by default
    # (fail closed): the /display-data endpoint returns 404 unless this is
    # explicitly turned on, so a fresh install never exposes it by accident.
    "public_display_enabled": False,
    # External heartbeat (Healthchecks.io / Uptime Kuma push monitor) --
    # see scheduler_service.py's heartbeat job. Blank = off, same contract
    # as every other optional integration in this file.
    "heartbeat_url": "",
    # ntfy.sh (or a self-hosted instance) as a second notification channel
    # alongside Discord -- see ntfy_notifier.py. server_url defaults to the
    # public service since that's the common case; topic blank = off (a
    # server URL alone isn't enough to publish anywhere).
    "ntfy_server_url": "https://ntfy.sh",
    "ntfy_topic": "",
    # Automatic scheduled backups (routers/backup.py's write_auto_backup(),
    # scheduler_service.py's job) -- off by default, weekday follows the
    # same APScheduler convention as report_weekday (0=Monday). retention
    # is how many of the newest backup-*.json files to keep in
    # /data/backups before older ones are deleted.
    "auto_backup_enabled": False,
    "auto_backup_weekday": 0,
    "auto_backup_hour": 3,
    "auto_backup_minute": 0,
    "auto_backup_retention": 7,
    # Auto-delete 0-byte corrupted cache files found by the periodic scan
    # (see cache_manager.py's scan_for_corruption()/clean_corrupted_files(),
    # both pre-existing and reused as-is here). Off by default: this is the
    # one setting in this file that triggers a destructive action on its
    # own schedule rather than just sending a notification, so it stays
    # opt-in even though the detection itself is narrow/safe (0-byte files
    # only, see cache_manager.py's own reasoning).
    "auto_clean_corruption_enabled": False,
    # Per-service traffic alert -- one global threshold (GB in the last
    # ~24h of log tail) applied to every service independently; 0 = off,
    # same "0/blank = off" contract as every other optional field here.
    "traffic_alert_threshold_gb": 0.0,
    # Optional custom title shown on the public /display screen (see
    # routers/public_display.py) -- blank means the frontend just shows
    # its own default "CachePanel" title, same "blank = default" contract
    # as everywhere else in this file.
    "display_party_name": "",
    # IP/CIDR allowlist for the panel's own session-cookie login (4th
    # feature round, Welle 2) -- see auth_guard.py. Empty list = off (same
    # "empty = off" contract as everywhere else here), deliberately does
    # NOT gate Bearer-token requests (see auth_guard.py's own reasoning:
    # a token is its own, separate trust boundary, e.g. Home Assistant on
    # a different VLAN than the admin's own browser).
    "ip_allowlist": [],
    # Requests/minute allowed per Bearer API token (4th feature round,
    # Welle 2) -- see token_rate_limit.py. Unlike every other numeric
    # field above, 0 here does NOT mean "off": it's the one setting in
    # this file whose old, pre-Welle-2 behavior WAS unbounded, so 0 stays
    # available as an explicit opt-out for anyone who relied on that,
    # while new installs get a real default cap.
    "api_token_rate_limit_per_minute": 60,
    # Quiet hours (4th feature round, Welle 3) -- see services/quiet_hours.py
    # for which notifications this suppresses vs. leaves untouched, and why.
    # Off by default; the two start/end fields follow the same hour/minute-
    # int convention as report_hour/report_minute rather than a "HH:MM"
    # string, for the same reason (a plain <input type=time> maps directly
    # to two ints, no parsing needed on either side).
    "quiet_hours_enabled": False,
    "quiet_hours_start_hour": 22,
    "quiet_hours_start_minute": 0,
    "quiet_hours_end_hour": 8,
    "quiet_hours_end_minute": 0,
    # Per-event custom notification text (4th feature round, Welle 3) --
    # see services/notification_templates.py. Empty dict = every event uses
    # its existing hardcoded default text, unchanged; a key only needs to
    # be present here for events the user has actually customized.
    "notification_templates": {},
    # Monthly bandwidth-saved budget (4th feature round, Welle 3) -- see
    # scheduler_service.py's _check_monthly_budget job and
    # daily_stats_store.get_month_total(). 0 = off, same contract as
    # traffic_alert_threshold_gb above. Unlike that field (a bounded-log-tail
    # 24h reading), this is evaluated against daily_stats_store's real
    # per-day running total, since a calendar month is far wider than what
    # the access-log tail read can reliably cover -- see
    # daily_stats_store.get_month_total()'s own docstring.
    "monthly_budget_gb": 0.0,
    # Grafana one-click dashboard import (4th feature round, Welle 5) --
    # see services/grafana_import.py. Blank url/key = the Settings button
    # is disabled client-side rather than attempted and failing; the
    # import call itself always takes its own explicit datasource_uid
    # parameter rather than one stored here, since which datasource to use
    # is a per-import choice, not a standing setting.
    "grafana_url": "",
    "grafana_api_key": "",
    # SFTP backup target (4th feature round, Welle 5) -- see
    # services/sftp_backup.py. Off by default, same "explicit opt-in"
    # contract as auto_backup_enabled above (which this is layered on top
    # of: this fires only as a second leg of THAT job, never on its own
    # schedule). Only one of sftp_password/sftp_private_key is expected to
    # be set; sftp_backup.py prefers the private key when both are present.
    "sftp_backup_enabled": False,
    "sftp_host": "",
    "sftp_port": 22,
    "sftp_username": "",
    "sftp_password": "",
    "sftp_private_key": "",
    "sftp_remote_dir": "/backups",
    "sftp_retention": 7,
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
