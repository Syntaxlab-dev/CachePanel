"""Browser Web Push subscription management -- see
services/webpush_keys.py (VAPID key pair) and
services/webpush_subscriptions_store.py (stored subscriptions). A normal
/api/ route, no special handling in auth_guard.py needed: the existing
viewer-role block already covers POST here the same way it covers every
other mutating route, and any logged-in account (admin or viewer) should
be able to subscribe their own device -- this is a per-device notification
preference, not an admin-only setting like API tokens.
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.services import webpush_keys, webpush_notifier, webpush_subscriptions_store

router = APIRouter(prefix="/api/webpush", tags=["webpush"])


class SubscriptionBody(BaseModel):
    # Intentionally untyped beyond "it's a dict" -- this is the browser's
    # own PushSubscription.toJSON() shape, round-tripped unmodified to
    # pywebpush.webpush() elsewhere, so nothing here needs to know its
    # internal fields.
    subscription: dict


class UnsubscribeBody(BaseModel):
    endpoint: str


@router.get(
    "/vapid-public-key",
    summary="VAPID public key",
    description="The public half of this instance's Web Push signing key -- safe to expose to any "
    "authenticated caller, used as the applicationServerKey when the browser calls PushManager.subscribe().",
)
def get_vapid_public_key():
    return {"public_key": webpush_keys.get_public_key_b64()}


@router.post(
    "/subscribe",
    summary="Register this device for web push",
    description="Stores the subscription object the browser returned from PushManager.subscribe(). "
    "Subscribing again with the same endpoint (e.g. re-enabling on the same browser) overwrites the "
    "previous entry rather than creating a duplicate.",
)
def subscribe(body: SubscriptionBody):
    try:
        webpush_subscriptions_store.add_subscription(body.subscription)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"ok": True}


@router.post("/unsubscribe", summary="Remove this device's web push subscription")
def unsubscribe(body: UnsubscribeBody):
    webpush_subscriptions_store.remove_subscription(body.endpoint)
    return {"ok": True}


@router.post(
    "/test",
    summary="Send a web push test notification",
    description="Sends to every currently subscribed device (there's no single endpoint to test in "
    "isolation, unlike the Discord/ntfy test buttons) -- returns how many subscriptions exist so the "
    "frontend can tell 'sent to 0 devices' apart from a real send.",
)
def test_webpush():
    count = webpush_notifier.send_test_message()
    if count == 0:
        raise HTTPException(status_code=400, detail="No devices are subscribed yet -- enable push on this device first.")
    return {"message": "Test notification sent.", "subscriber_count": count}
