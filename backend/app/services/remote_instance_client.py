"""HTTP client for talking to a registered slave CachePanel instance (4th
feature round, Welle 4) -- the master side of the master-slave system. See
slave_instance_store.py for how a slave's URL + instance token get
registered, and instance_token_store.py / auth_guard.py for what the
instance token that's sent back to it is allowed to do on the slave's end.

HTTP vs. HTTPS: no scheme is enforced or assumed here -- `base_url` is
used exactly as the admin entered it (matching discord_webhook_url and
every other admin-supplied URL in this project). The expected common case
is both instances living on the same internal network, the same way this
instance itself is typically reached directly over plain HTTP behind a LAN
reverse proxy (see main.py's SessionMiddleware(https_only=False) comment)
-- an admin who wants encryption in transit between instances is expected
to put both behind their own reverse proxy/VPN, same as for the panel's
own external access, rather than this client special-casing TLS.

Two timeouts, deliberately different (same reasoning as cli/cachepanel-cli.py's
_LONG_RUNNING_TIMEOUT, which hit exactly this issue with the CLI's short
default timeout aborting a real prefill run):
- fetch_remote_status(): a plain read, short timeout is correct.
- trigger_remote_prefill(): the slave's own POST /api/prefill/{service}/run
  blocks until the whole download finishes, which can be minutes for a
  large game -- needs the same generous budget the CLI tool already uses.
"""

import requests

_STATUS_TIMEOUT = 10
_PREFILL_TIMEOUT = 1800  # 30 minutes, see module docstring


class RemoteInstanceError(RuntimeError):
    pass


def _headers(token: str | None) -> dict:
    if not token:
        # token is None when slave_instance_store.get_instance() failed to
        # decrypt it (see that module's fail-soft comment) -- surfaced here
        # as a clear, catchable error rather than sending an
        # "Authorization: Bearer None" header that would just 401 anyway.
        raise RemoteInstanceError("Stored instance token could not be decrypted for this slave.")
    return {"Authorization": f"Bearer {token}"}


def fetch_remote_status(instance: dict) -> dict:
    """GET the slave's own read-only status summary (the same
    /api/ha/sensors endpoint Home Assistant integrations already use --
    reused rather than inventing a second summary shape). Raises
    RemoteInstanceError on any failure (timeout, connection refused, non-2xx)
    -- callers building a multi-instance overview (routers/instances.py's
    summary endpoint) are expected to catch this PER instance so one
    unreachable slave doesn't take down the whole view."""
    url = f"{instance['base_url'].rstrip('/')}/api/ha/sensors"
    try:
        resp = requests.get(url, headers=_headers(instance.get("token")), timeout=_STATUS_TIMEOUT)
    except requests.RequestException as exc:
        raise RemoteInstanceError(f"Could not reach {instance['name']}: {exc}") from exc
    if resp.status_code != 200:
        raise RemoteInstanceError(f"{instance['name']} returned HTTP {resp.status_code}")
    try:
        return resp.json()
    except ValueError as exc:
        raise RemoteInstanceError(f"{instance['name']} returned a non-JSON response") from exc


def trigger_remote_prefill(instance: dict, service: str) -> dict:
    """POST to the slave's own prefill-run endpoint with its instance
    token, and return whatever it returns (service/exit_code/output, same
    shape as routers/prefill.py's own response) once the run finishes."""
    url = f"{instance['base_url'].rstrip('/')}/api/prefill/{service}/run"
    try:
        resp = requests.post(url, headers=_headers(instance.get("token")), timeout=_PREFILL_TIMEOUT)
    except requests.Timeout as exc:
        raise RemoteInstanceError(
            f"{instance['name']} did not finish the {service} prefill within {_PREFILL_TIMEOUT}s."
        ) from exc
    except requests.RequestException as exc:
        raise RemoteInstanceError(f"Could not reach {instance['name']}: {exc}") from exc
    if resp.status_code != 200:
        detail = ""
        try:
            detail = resp.json().get("detail", "")
        except ValueError:
            pass
        raise RemoteInstanceError(f"{instance['name']} rejected the {service} prefill (HTTP {resp.status_code}): {detail}")
    return resp.json()
