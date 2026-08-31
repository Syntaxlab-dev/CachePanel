"""Optional SFTP push for the automatic backup (4th feature round, Welle
5) -- a second, external leg on top of the existing local
`/data/backups/` snapshots from backup_builder.write_auto_backup(), not a
replacement for them. Uploads the exact same backup-*.json file the local
job just wrote, unmodified -- the SFTP side never re-builds or re-encrypts
the bundle itself, so there is only ever one code path that decides what a
backup contains (backup_builder.py).

Auth: password OR a private key (PEM text, pasted into Settings) -- never
both required, whichever is non-empty in the caller's config wins (private
key first, since a key without a password is the more common setup for an
automated push like this). Both are stored encrypted at rest exactly like
every other secret in app_settings_store.py's Fernet-encrypted blob -- no
separate encryption layer needed here, this module only ever receives
already-decrypted values from its caller and never persists anything
itself.

Remote retention mirrors write_auto_backup()'s own local retention
contract: only files matching THIS module's own upload naming (whatever
local filename backup_builder wrote, since the remote copy keeps the exact
same name) are ever touched by cleanup, so a shared SFTP target used for
other things is never at risk of this module deleting something it didn't
create.
"""

import io
import stat
from pathlib import Path

import paramiko

_CONNECT_TIMEOUT = 10


class SftpBackupError(RuntimeError):
    pass


def _parse_private_key(key_text: str, password: str | None) -> paramiko.PKey:
    """Tries each key type paramiko supports in turn -- there's no key-type
    marker in a bare PEM block itself that would let us pick the right
    parser up front, and asking the user to also specify "this is an
    Ed25519 key" in a second field would be one more thing to get wrong.
    Raises SftpBackupError with a clear message if none of them parse."""
    # DSA (paramiko's old DSSKey) isn't tried: paramiko 5.0 dropped it
    # entirely (deprecated, insecure key type), so it's not worth
    # supporting here either.
    key_classes = (paramiko.Ed25519Key, paramiko.RSAKey, paramiko.ECDSAKey)
    last_error: Exception | None = None
    for key_class in key_classes:
        try:
            return key_class.from_private_key(io.StringIO(key_text), password=password or None)
        except paramiko.SSHException as exc:
            last_error = exc
            continue
    raise SftpBackupError(f"Could not parse the private key (tried all supported key types): {last_error}")


def _connect(host: str, port: int, username: str, password: str, private_key: str) -> paramiko.SSHClient:
    if not host or not username:
        raise SftpBackupError("Host and username are required.")

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())

    connect_kwargs: dict = {
        "hostname": host,
        "port": port or 22,
        "username": username,
        "timeout": _CONNECT_TIMEOUT,
        "banner_timeout": _CONNECT_TIMEOUT,
        "auth_timeout": _CONNECT_TIMEOUT,
    }
    if private_key:
        connect_kwargs["pkey"] = _parse_private_key(private_key, password)
    elif password:
        connect_kwargs["password"] = password
    else:
        raise SftpBackupError("Either a password or a private key is required.")

    try:
        client.connect(**connect_kwargs)
    except Exception as exc:
        client.close()
        raise SftpBackupError(f"Could not connect: {exc}") from exc
    return client


def test_connection(host: str, port: int, username: str, password: str, private_key: str, remote_dir: str) -> None:
    """Connects, opens SFTP, and confirms `remote_dir` exists (creating it
    if it doesn't -- same as upload_backup() would need to on the first
    real backup, so a successful test genuinely proves the whole path
    works) -- but NEVER uploads anything. Raises SftpBackupError with a
    human-readable reason on any failure; returns None on success."""
    client = _connect(host, port, username, password, private_key)
    try:
        sftp = client.open_sftp()
        try:
            _ensure_remote_dir(sftp, remote_dir or "/backups")
        finally:
            sftp.close()
    except SftpBackupError:
        raise
    except Exception as exc:
        raise SftpBackupError(f"Connected, but the SFTP check failed: {exc}") from exc
    finally:
        client.close()


def _ensure_remote_dir(sftp: paramiko.SFTPClient, remote_dir: str) -> None:
    try:
        attrs = sftp.stat(remote_dir)
    except FileNotFoundError:
        sftp.mkdir(remote_dir)
        return
    if not stat.S_ISDIR(attrs.st_mode or 0):
        raise SftpBackupError(f"{remote_dir} exists on the remote server but is not a directory.")


def upload_backup(
    host: str,
    port: int,
    username: str,
    password: str,
    private_key: str,
    remote_dir: str,
    local_path: Path,
    retention: int,
) -> None:
    """Uploads `local_path` (a backup-*.json file backup_builder.py just
    wrote locally) to `remote_dir` under its own filename, then deletes
    the oldest remote backup-*.json files beyond `retention` -- same
    newest-N-kept contract as write_auto_backup()'s local cleanup, just
    applied to the remote directory listing instead of a local glob."""
    client = _connect(host, port, username, password, private_key)
    try:
        sftp = client.open_sftp()
        try:
            remote_dir = remote_dir or "/backups"
            _ensure_remote_dir(sftp, remote_dir)

            remote_path = f"{remote_dir.rstrip('/')}/{local_path.name}"
            sftp.put(str(local_path), remote_path)

            existing = sorted(
                (name for name in sftp.listdir(remote_dir) if name.startswith("backup-") and name.endswith(".json")),
                reverse=True,
            )
            for stale in existing[max(retention, 0):]:
                sftp.remove(f"{remote_dir.rstrip('/')}/{stale}")
        finally:
            sftp.close()
    except SftpBackupError:
        raise
    except Exception as exc:
        raise SftpBackupError(f"Upload failed: {exc}") from exc
    finally:
        client.close()
