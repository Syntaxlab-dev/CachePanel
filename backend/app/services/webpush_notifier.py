"""Browser Web Push notifications -- a third, independent channel alongside
discord_notifier.py/ntfy_notifier.py for the same events, delivered
straight to a device's installed PWA (or any browser tab that granted
notification permission) via frontend/public/sw.js's `push` handler. Same
never-raises contract as the other two notifiers: a delivery failure to
one (or all) subscribed devices must never turn a prefill run or a
scheduler job into a 500.

Sends to every stored subscription, not just one -- multiple devices can
each opt in independently (see webpush_subscriptions_store.py). A 404/410
response from the push service means that specific subscription is dead
(browser data cleared, permission revoked, etc.) -- pywebpush raises
WebPushException for that like any other non-2xx response, so it's
distinguished by inspecting the wrapped response's status code and, only
for 404/410, the dead subscription is removed here rather than left to
fail identically forever.
"""

import json
import logging

from pywebpush import WebPushException, webpush

from app.services import webpush_keys, webpush_subscriptions_store

logger = logging.getLogger("cachepanel.webpush")

_VAPID_CLAIMS = {"sub": "mailto:admin@example.com"}
_EXPIRED_STATUS_CODES = {404, 410}


def _send_to_all(title: str, body: str) -> None:
    subscriptions = webpush_subscriptions_store.list_subscriptions()
    if not subscriptions:
        return

    payload = json.dumps({"title": title, "body": body})
    for subscription in subscriptions:
        try:
            webpush(
                subscription_info=subscription,
                data=payload,
                vapid_private_key=webpush_keys.get_vapid(),
                vapid_claims=dict(_VAPID_CLAIMS),
            )
        except WebPushException as exc:
            status_code = getattr(exc.response, "status_code", None)
            if status_code in _EXPIRED_STATUS_CODES:
                webpush_subscriptions_store.remove_subscription(subscription.get("endpoint", ""))
            else:
                logger.warning("Web push delivery failed (%s): %s", status_code, exc)
        except Exception:
            # Never let a malformed subscription or an unexpected pywebpush
            # error abort the whole batch -- one bad device shouldn't stop
            # the rest from being notified, same reasoning as
            # discord_notifier.py/ntfy_notifier.py's own try/except.
            logger.exception("Web push delivery failed unexpectedly")


def notify_prefill_success(service: str, duration_seconds: float, template: str | None = None) -> None:
    _send_to_all("CachePanel", template or f"{service} prefill finished successfully in {duration_seconds:.0f}s.")


def notify_prefill_failure(service: str, exit_code: int, template: str | None = None) -> None:
    _send_to_all("CachePanel", template or f"{service} prefill failed (exit code {exit_code}).")


def notify_disk_warning(percent_used: float, template: str | None = None) -> None:
    _send_to_all("CachePanel", template or f"LanCache disk is {percent_used:.0f}% full. Consider clearing old cache data.")


def notify_auto_cleanup(deleted_count: int) -> None:
    _send_to_all("CachePanel", f"Automatically removed {deleted_count} corrupted (0-byte) cache file(s).")


def notify_traffic_alert(service: str, gb_used: float, threshold_gb: float, template: str | None = None) -> None:
    text = template or (
        f"{service} traffic in the last 24h ({gb_used:.1f} GB) crossed the configured alert threshold "
        f"({threshold_gb:.1f} GB)."
    )
    _send_to_all("CachePanel", text)


def notify_monthly_budget(gb_used: float, budget_gb: float, percent: float, exceeded: bool) -> None:
    verb = "exceeded" if exceeded else f"reached {percent:.0f}% of"
    _send_to_all(
        "CachePanel",
        f"This month's cache traffic ({gb_used:.1f} GB) has {verb} the configured monthly budget ({budget_gb:.1f} GB).",
    )


def notify_cache_report(
    total_requests: int, hit_ratio: float, bandwidth_saved_gb: float, template: str | None = None
) -> None:
    text = template or (
        f"{total_requests:,} requests, {hit_ratio * 100:.0f}% served from cache, "
        f"{bandwidth_saved_gb:.1f} GB saved."
    )
    _send_to_all("CachePanel — weekly report", text)


def send_test_message() -> int:
    """Used by the Settings page's "send test notification" button.
    Returns how many subscriptions currently exist (so the frontend can
    tell "sent to 0 devices, subscribe first" apart from a genuine send) --
    unlike discord/ntfy's single-URL test, there's no one endpoint to
    report success/failure for individually here."""
    subscriptions = webpush_subscriptions_store.list_subscriptions()
    _send_to_all("CachePanel", "This is a test notification from CachePanel.")
    return len(subscriptions)
