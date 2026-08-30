from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.services import app_settings_store, cache_report, discord_notifier, ntfy_notifier, scheduler_service, update_check
from app.settings import settings

router = APIRouter(prefix="/api/settings", tags=["settings"])


class SettingsUpdate(BaseModel):
    steam_api_key: str | None = None
    steam_id64: str | None = None
    steamgriddb_api_key: str | None = None
    discord_webhook_url: str | None = None
    discord_notify_success: bool | None = None
    discord_notify_failure: bool | None = None
    discord_notify_disk_warning: bool | None = None
    run_history_limit: int | None = None
    report_enabled: bool | None = None
    report_weekday: int | None = None
    report_hour: int | None = None
    report_minute: int | None = None
    public_display_enabled: bool | None = None
    heartbeat_url: str | None = None
    ntfy_server_url: str | None = None
    ntfy_topic: str | None = None


class NotificationTestRequest(BaseModel):
    webhook_url: str


class NtfyTestRequest(BaseModel):
    server_url: str
    topic: str


@router.get("", summary="Current app settings", description="Steam API key + SteamID64, as stored (encrypted at rest) on this instance. Never shared with anyone else.")
def get_settings():
    return app_settings_store.get_settings()


@router.post("", summary="Update app settings", description="Partial update -- only non-null fields in the body are changed.")
def update_settings(body: SettingsUpdate):
    partial = {k: v for k, v in body.model_dump().items() if v is not None}
    updated = app_settings_store.update_settings(partial)
    # Cheap either way (just a remove+re-add of one job) -- always reload
    # rather than only when a report_* field is present, same unconditional
    # style as routers/schedule.py's reload_jobs() call.
    scheduler_service.reload_report_job()
    return updated


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


@router.post(
    "/notifications/test-ntfy",
    summary="Send an ntfy test message",
    description="Posts a test message to the given ntfy server/topic directly (not necessarily the saved "
    "one), so the user can verify it works before saving.",
)
def test_ntfy(body: NtfyTestRequest):
    if not ntfy_notifier.send_test_message(body.server_url, body.topic):
        raise HTTPException(status_code=400, detail="Could not deliver the test message -- check server/topic.")
    return {"message": "Test message sent."}


@router.post(
    "/notifications/test-report",
    summary="Send a Discord cache report now",
    description="Builds the same weekly summary the scheduled report job sends (see cache_report.py) and "
    "posts it immediately to the given webhook URL -- not necessarily the saved one -- so the user can "
    "preview it before enabling the weekly schedule.",
)
def test_report(body: NotificationTestRequest):
    summary = cache_report.build_report()
    delivered = discord_notifier.notify_cache_report(
        body.webhook_url,
        total_requests=summary["total_requests"],
        hit_ratio=summary["hit_ratio"],
        bandwidth_saved_bytes=summary["bandwidth_saved_bytes"],
        percent_used=summary["percent_used"],
        hours_until_full=summary["hours_until_full"],
    )
    if not delivered:
        raise HTTPException(status_code=400, detail="Could not deliver the report -- check the webhook URL.")
    return {"message": "Report sent."}


@router.get(
    "/version",
    summary="Running version",
    description="The Git commit SHA baked into this image at build time (see the Dockerfile's GIT_SHA build "
    "arg), or empty for a plain local `docker compose build`.",
)
def get_version():
    return {
        "git_sha": settings.git_sha,
        "git_sha_short": settings.git_sha[:7] if settings.git_sha else "",
        "repo_url": "https://github.com/Syntaxlab-dev/CachePanel",
    }


@router.get(
    "/update-check",
    summary="Check for a newer published image",
    description="One-shot comparison of the running build's Git SHA against the `latest` GHCR tag's revision "
    "label. Never raises -- `checked: false` means the check itself couldn't complete (network, local build "
    "with no baked-in SHA, unexpected registry response), not that no update was found.",
)
def get_update_check():
    return update_check.check_for_update(settings.git_sha)
