"""Optional Discord webhook notifications for prefill results and disk
space warnings.

Entirely optional: no webhook URL configured -> every notify_* call below
is a silent no-op, same "blank = feature off" contract as LANCACHE_IP
(health.py) and steamgriddb_api_key (cover_art.py). A Discord outage or a
bad URL must never break a real prefill run, so every call here is wrapped
in try/except with a short timeout and only ever logged on failure --
nothing here is allowed to raise.
"""

import logging

import requests

logger = logging.getLogger("cachepanel.discord")

_REQUEST_TIMEOUT = 5


def _post(webhook_url: str, content: str) -> bool:
    if not webhook_url:
        return False
    try:
        resp = requests.post(webhook_url, json={"content": content}, timeout=_REQUEST_TIMEOUT)
        if resp.status_code >= 300:
            logger.warning("Discord webhook returned %s: %s", resp.status_code, resp.text[:300])
            return False
        return True
    except requests.RequestException:
        logger.exception("Discord webhook POST failed")
        return False


def notify_prefill_success(webhook_url: str, service: str, duration_seconds: float) -> None:
    _post(webhook_url, f":white_check_mark: **{service}** prefill finished successfully in {duration_seconds:.0f}s.")


def notify_prefill_failure(webhook_url: str, service: str, exit_code: int) -> None:
    _post(webhook_url, f":x: **{service}** prefill failed (exit code {exit_code}).")


def notify_disk_warning(webhook_url: str, percent_used: float) -> None:
    _post(
        webhook_url,
        f":warning: LanCache disk is **{percent_used:.0f}% full**. "
        "Consider clearing old cache data in CachePanel.",
    )


def send_test_message(webhook_url: str) -> bool:
    """Used by the Settings page's "send test message" button -- takes the
    URL directly rather than reading it from stored settings, so the user
    can verify it before saving."""
    return _post(webhook_url, ":bell: This is a test notification from CachePanel.")
