from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from app.services import (
    app_settings_store,
    audit_log_store,
    cache_report,
    discord_notifier,
    grafana_import,
    notification_templates,
    ntfy_notifier,
    scheduler_service,
    sftp_backup,
    update_check,
)
from app.settings import settings

router = APIRouter(prefix="/api/settings", tags=["settings"])

def _client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


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
    auto_backup_enabled: bool | None = None
    auto_backup_weekday: int | None = None
    auto_backup_hour: int | None = None
    auto_backup_minute: int | None = None
    auto_backup_retention: int | None = None
    auto_clean_corruption_enabled: bool | None = None
    traffic_alert_threshold_gb: float | None = None
    display_party_name: str | None = None
    ip_allowlist: list[str] | None = None
    api_token_rate_limit_per_minute: int | None = None
    quiet_hours_enabled: bool | None = None
    quiet_hours_start_hour: int | None = None
    quiet_hours_start_minute: int | None = None
    quiet_hours_end_hour: int | None = None
    quiet_hours_end_minute: int | None = None
    notification_templates: dict[str, str] | None = None
    monthly_budget_gb: float | None = None
    grafana_url: str | None = None
    grafana_api_key: str | None = None
    sftp_backup_enabled: bool | None = None
    sftp_host: str | None = None
    sftp_port: int | None = None
    sftp_username: str | None = None
    sftp_password: str | None = None
    sftp_private_key: str | None = None
    sftp_remote_dir: str | None = None
    sftp_retention: int | None = None


class TemplatePreviewRequest(BaseModel):
    event_key: str
    template: str


class NotificationTestRequest(BaseModel):
    webhook_url: str


class NtfyTestRequest(BaseModel):
    server_url: str
    topic: str


class GrafanaImportRequest(BaseModel):
    # Only needed when list_prometheus_datasources() found more than one
    # candidate on a previous attempt -- see grafana_import.py's own
    # docstring for why this isn't just always required.
    datasource_uid: str | None = None


class SftpTestRequest(BaseModel):
    host: str
    port: int = 22
    username: str
    password: str = ""
    private_key: str = ""
    remote_dir: str = "/backups"


@router.get("", summary="Current app settings", description="Steam API key + SteamID64, as stored (encrypted at rest) on this instance. Never shared with anyone else. Also carries the caller's own current client_ip (not a persisted setting) so the ip_allowlist editor in Settings can warn before saving a list that would exclude the very browser editing it.")
def get_settings(request: Request):
    return {**app_settings_store.get_settings(), "client_ip": request.client.host if request.client else ""}


@router.post("", summary="Update app settings", description="Partial update -- only non-null fields in the body are changed.")
def update_settings(body: SettingsUpdate, request: Request):
    partial = {k: v for k, v in body.model_dump().items() if v is not None}

    if "notification_templates" in partial:
        for event_key, template in partial["notification_templates"].items():
            try:
                notification_templates.validate(event_key, template)
            except notification_templates.TemplateError as exc:
                raise HTTPException(status_code=400, detail=str(exc)) from exc

    updated = app_settings_store.update_settings(partial)

    # Field NAMES only, never values -- secrets (Steam/SteamGridDB API keys,
    # Discord webhook URL, ...) live among these fields, so the audit trail
    # records that e.g. discord_webhook_url changed without ever writing
    # what it changed to or from.
    if partial:
        audit_log_store.log(
            "settings_changed",
            request.session.get("username"),
            f"Changed: {', '.join(sorted(partial.keys()))}",
            _client_ip(request),
        )

    # Cheap either way (just a remove+re-add of one job each) -- always
    # reload rather than only when a relevant field is present, same
    # unconditional style as routers/schedule.py's reload_jobs() call.
    scheduler_service.reload_report_job()
    scheduler_service.reload_auto_backup_job()
    return updated


@router.post(
    "/notification-templates/preview",
    summary="Preview a notification template",
    description="Renders `template` against fixed sample data for `event_key`, without saving it -- validates "
    "placeholders the same way a real save would, so an invalid template surfaces here first.",
)
def preview_notification_template(body: TemplatePreviewRequest):
    try:
        return {"preview": notification_templates.preview(body.event_key, body.template)}
    except notification_templates.TemplateError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


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


@router.post(
    "/grafana/import",
    summary="Import the bundled Grafana dashboard",
    description="Imports grafana/cachepanel-dashboard.json into the Grafana instance configured in Settings "
    "(grafana_url/grafana_api_key must already be saved). Auto-detects the Prometheus datasource to wire the "
    "dashboard to; if more than one exists, `datasource_uid` must be supplied (see the `candidates` field on "
    "a 409 response) to disambiguate.",
)
def import_grafana_dashboard(body: GrafanaImportRequest, request: Request):
    cfg = app_settings_store.get_settings()
    grafana_url = cfg.get("grafana_url") or ""
    api_key = cfg.get("grafana_api_key") or ""
    if not grafana_url or not api_key:
        raise HTTPException(status_code=400, detail="Grafana-URL und API-Key müssen erst gespeichert werden.")

    try:
        result = grafana_import.import_dashboard(grafana_url, api_key, body.datasource_uid)
    except grafana_import.DatasourceAmbiguousError as exc:
        raise HTTPException(status_code=409, detail={"message": str(exc), "candidates": exc.candidates}) from exc
    except grafana_import.GrafanaImportError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    audit_log_store.log(
        "grafana_dashboard_imported", request.session.get("username"), f"grafana_url={grafana_url}", _client_ip(request)
    )
    return result


@router.post(
    "/sftp/test",
    summary="Test an SFTP backup target",
    description="Connects and confirms the remote directory is reachable (creating it if it doesn't exist "
    "yet) using the given connection details directly -- not necessarily the saved ones, same "
    "test-before-saving pattern as the Discord/ntfy test endpoints above. Never uploads anything.",
)
def test_sftp(body: SftpTestRequest):
    try:
        sftp_backup.test_connection(
            body.host, body.port, body.username, body.password, body.private_key, body.remote_dir
        )
    except sftp_backup.SftpBackupError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"message": "Connection successful."}


@router.get(
    "/update-check",
    summary="Check for a newer published image",
    description="One-shot comparison of the running build's Git SHA against the `latest` GHCR tag's revision "
    "label. Never raises -- `checked: false` means the check itself couldn't complete (network, local build "
    "with no baked-in SHA, unexpected registry response), not that no update was found.",
)
def get_update_check():
    return update_check.check_for_update(settings.git_sha)
