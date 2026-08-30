"""Full-state backup/restore -- settings, schedule, run history, and the
panel login, bundled as one JSON document. Deliberately separate from
export_import.py, which only covers the Steam/Battle.net/Epic prefill
selection (a different, narrower concern with its own schema version).

The settings portion (Steam API key, Discord webhook URL, etc.) is carried
as the raw Fernet-encrypted blob (base64-encoded for JSON transport), NOT
decrypted to plaintext -- settings_encryption.py's own docstring names "it
ends up in a misconfigured backup" as precisely the leak scenario that
encryption defends against, so a backup feature handing back plaintext
secrets would quietly defeat that protection for the one artifact most
likely to actually get copied/synced/emailed somewhere. The trade-off:
this blob only decrypts successfully on the SAME host it was taken from
(the .encryption_key it needs is deliberately not included in the backup
either). Restoring onto a different host restores schedule/history/login
fine, but the settings blob fails to decrypt there and silently falls back
to defaults (the existing, already-established behavior in
app_settings_store's _read_raw_file()/_read_raw_db()) -- the user re-enters
Steam key etc. rather than the app leaking them in a portable file. This is
a deliberate scope limit, not a bug: same-host recovery (accidentally
deleted ./data, container recreated, etc.) is the common case a backup
button actually needs to cover; full hardware-loss disaster recovery is
better handled by backing up the whole `data/` volume (including
.encryption_key) at the infrastructure level, same as any other self-hosted
app's persistent volume.

The bcrypt password hashes (panel logins), by contrast, ARE included as-is
-- see auth_credentials_store.py's own reasoning: a bcrypt hash is already
safe to store/expose, wrapping it in another encryption layer wouldn't add
real protection. Since Welle 4 (multi-user panel logins) this is every
account, not just one. Since the 3rd feature round each account entry also
carries `role` (str), `totp_secret` (str or null) and `totp_enabled`
(bool) -- see the widened `auth` field type below, which used to be
`dict[str, str]` and would otherwise reject a real backup taken after this
round with a Pydantic validation error on `totp_enabled` not being a string.

The bundle-assembly logic itself lives in services/backup_builder.py, not
here -- see that module's docstring for why (scheduler_service.py's
automatic-backup job needs the same builder without a service importing a
router).
"""

import base64

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.services import app_settings_store, auth_credentials_store, backup_builder, run_history_store, schedule_store

router = APIRouter(prefix="/api/backup", tags=["backup"])

SCHEMA_VERSION = backup_builder.SCHEMA_VERSION


class BackupBundle(BaseModel):
    schema_version: int
    settings_encrypted: str
    schedule: dict[str, dict]
    run_history: list[dict]
    # Accepts both the current list-of-accounts shape and a pre-Welle-4
    # single-object backup (normalized to a one-item list in restore_backup
    # below), so an older backup file still restores after this upgrade.
    # Untyped `dict` (not `dict[str, str]`) because an account entry now
    # also carries non-string fields (`totp_enabled` is a bool, `totp_secret`
    # can be null) -- see the module docstring.
    auth: list[dict] | dict | None = Field(default_factory=list)


@router.get(
    "",
    summary="Full state backup",
    description="Bundles settings, schedule, and run history (plus the panel login, if configured) into one "
    "JSON document -- everything except the Steam/Battle.net/Epic prefill selection, which has its own "
    "separate export at /api/export. Settings stay Fernet-encrypted inside the bundle (same as at rest) and "
    "only decrypt successfully when restored on this same host; the panel login is included as its bcrypt "
    "hash, never a plaintext password.",
)
def get_backup():
    return backup_builder.build_backup_bundle()


@router.post(
    "/restore",
    summary="Restore full state",
    description="Replaces settings, schedule, run history, and (if present in the bundle) the panel login "
    "from a previously downloaded backup. All-or-nothing: rejected entirely if the schema version doesn't "
    "match. The settings blob only decrypts successfully if restored on the same host it was backed up from "
    "-- on a different host it silently falls back to blank settings rather than erroring, so restoring the "
    "rest of the bundle still succeeds. The panel login in the bundle is a bcrypt hash, not a plaintext "
    "password -- restoring it doesn't require (or allow) choosing a new password.",
)
def restore_backup(bundle: BackupBundle):
    if bundle.schema_version != SCHEMA_VERSION:
        raise HTTPException(
            status_code=400,
            detail=f"Unbekannte Backup-Version {bundle.schema_version} (erwartet: {SCHEMA_VERSION})",
        )

    try:
        blob = base64.b64decode(bundle.settings_encrypted)
    except (ValueError, TypeError) as exc:
        raise HTTPException(status_code=400, detail="Ungültiges Backup: Settings-Block nicht lesbar.") from exc

    app_settings_store.restore_encrypted_blob(blob)
    schedule_store.update_schedule(bundle.schedule)
    run_history_store.replace_all(bundle.run_history)
    if bundle.auth:
        users = [bundle.auth] if isinstance(bundle.auth, dict) else bundle.auth
        auth_credentials_store.restore_credentials(users)

    return {"ok": True}
