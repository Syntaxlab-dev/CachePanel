from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.services import app_settings_store, discord_notifier

router = APIRouter(prefix="/api/settings", tags=["settings"])


class SettingsUpdate(BaseModel):
    steam_api_key: str | None = None
    steam_id64: str | None = None
    steamgriddb_api_key: str | None = None
    discord_webhook_url: str | None = None
    discord_notify_success: bool | None = None
    discord_notify_failure: bool | None = None
    discord_notify_disk_warning: bool | None = None


class NotificationTestRequest(BaseModel):
    webhook_url: str


@router.get("", summary="Current app settings", description="Steam API key + SteamID64, as stored (encrypted at rest) on this instance. Never shared with anyone else.")
def get_settings():
    return app_settings_store.get_settings()


@router.post("", summary="Update app settings", description="Partial update -- only non-null fields in the body are changed.")
def update_settings(body: SettingsUpdate):
    partial = {k: v for k, v in body.model_dump().items() if v is not None}
    return app_settings_store.update_settings(partial)


@router.post(
    "/notifications/test",
    summary="Send a Discord test message",
    description="Posts a test message to the given webhook URL directly (not the saved one), so the user can "
    "verify it works before saving.",
)
def test_notification(body: NotificationTestRequest):
    if not discord_notifier.send_test_message(body.webhook_url):
        raise HTTPException(status_code=400, detail="Could not deliver the test message -- check the webhook URL.")
    return {"message": "Test message sent."}
