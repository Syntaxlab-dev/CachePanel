"""Optional ntfy (https://ntfy.sh, or a self-hosted instance) notifications
-- a second, independent channel alongside discord_notifier.py for the
same events (prefill results, disk warnings). Same "blank = off" contract:
no topic configured -> every notify_* call below is a silent no-op, and a
server/topic being unreachable never raises -- see discord_notifier.py's
docstring for the full reasoning, which applies identically here.

ntfy's publish API is a plain POST to {server_url}/{topic} with the
message as the raw body (not JSON) -- title and priority are set via the
X-Title/X-Priority headers rather than a body field, per ntfy's own
convention.
"""

import logging

import requests

logger = logging.getLogger("cachepanel.ntfy")

_REQUEST_TIMEOUT = 5


def _publish(server_url: str, topic: str, title: str, message: str, priority: str = "default") -> bool:
    if not server_url or not topic:
        return False
    url = f"{server_url.rstrip('/')}/{topic}"
    try:
        resp = requests.post(
            url,
            data=message.encode("utf-8"),
            headers={"X-Title": title, "X-Priority": priority},
            timeout=_REQUEST_TIMEOUT,
        )
        if resp.status_code >= 300:
            logger.warning("ntfy publish returned %s: %s", resp.status_code, resp.text[:300])
            return False
        return True
    except requests.RequestException:
        logger.exception("ntfy publish failed")
        return False


def notify_prefill_success(server_url: str, topic: str, service: str, duration_seconds: float) -> None:
    _publish(server_url, topic, "CachePanel", f"{service} prefill finished successfully in {duration_seconds:.0f}s.")


def notify_prefill_failure(server_url: str, topic: str, service: str, exit_code: int) -> None:
    _publish(server_url, topic, "CachePanel", f"{service} prefill failed (exit code {exit_code}).", priority="high")


def notify_disk_warning(server_url: str, topic: str, percent_used: float) -> None:
    _publish(
        server_url,
        topic,
        "CachePanel",
        f"LanCache disk is {percent_used:.0f}% full. Consider clearing old cache data in CachePanel.",
        priority="high",
    )


def send_test_message(server_url: str, topic: str) -> bool:
    """Used by the Settings page's "send test message" button -- takes the
    server/topic directly rather than reading them from stored settings, so
    the user can verify it before saving."""
    return _publish(server_url, topic, "CachePanel", "This is a test notification from CachePanel.")
