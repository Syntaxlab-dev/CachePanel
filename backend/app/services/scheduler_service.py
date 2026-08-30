"""CachePanel's own background scheduler for automatic prefill runs.

Uses APScheduler's BackgroundScheduler rather than the async variant --
trigger_prefill() is a blocking call (docker exec_run waits for the whole
run), and BackgroundScheduler already executes each job in its own thread
pool, fully decoupled from uvicorn's asyncio event loop. No extra
asyncio-integration plumbing needed.

Job IDs are fixed per service ("prefill-steam" etc.) so reload_jobs() can
cleanly remove-and-re-add them whenever the schedule config changes,
instead of accumulating duplicate jobs.
"""

import logging

import requests
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger

from app.services import app_settings_store, cache_manager, cache_report, discord_notifier, ntfy_notifier, schedule_store
from app.services.cache_manager import CacheManagerError
from app.services.prefill_runner import PrefillRunnerError, trigger_prefill

logger = logging.getLogger("cachepanel.scheduler")

_scheduler = BackgroundScheduler()

_DISK_WARNING_JOB_ID = "disk-warning-check"
_DISK_WARNING_THRESHOLD_PERCENT = 90
_DISK_WARNING_INTERVAL_MINUTES = 30

_REPORT_JOB_ID = "cache-report"

_HEARTBEAT_JOB_ID = "heartbeat-ping"
_HEARTBEAT_INTERVAL_MINUTES = 1
_HEARTBEAT_REQUEST_TIMEOUT = 5

# Tracks whether a disk-warning notification has already fired for the
# *current* above-threshold spell, so a still-full disk doesn't re-notify
# every single interval -- only on the transition, and again after it drops
# back below the threshold and crosses it again.
_disk_warning_active = False


def _run_job(service: str) -> None:
    try:
        trigger_prefill(service)
    except PrefillRunnerError:
        logger.exception("Scheduled prefill run failed for service=%s", service)


def _check_disk_warning() -> None:
    global _disk_warning_active
    cfg = app_settings_store.get_settings()
    webhook_url = cfg.get("discord_webhook_url") or ""
    ntfy_topic = cfg.get("ntfy_topic") or ""
    if not cfg.get("discord_notify_disk_warning") or (not webhook_url and not ntfy_topic):
        return

    try:
        usage = cache_manager.get_disk_usage()
    except CacheManagerError:
        logger.exception("Disk-warning check could not read disk usage")
        return

    if usage.percent_used >= _DISK_WARNING_THRESHOLD_PERCENT:
        if not _disk_warning_active:
            if webhook_url:
                discord_notifier.notify_disk_warning(webhook_url, usage.percent_used)
            if ntfy_topic:
                ntfy_notifier.notify_disk_warning(cfg.get("ntfy_server_url") or "", ntfy_topic, usage.percent_used)
            _disk_warning_active = True
    else:
        _disk_warning_active = False


def _ping_heartbeat() -> None:
    cfg = app_settings_store.get_settings()
    heartbeat_url = cfg.get("heartbeat_url") or ""
    if not heartbeat_url:
        return
    try:
        requests.get(heartbeat_url, timeout=_HEARTBEAT_REQUEST_TIMEOUT)
    except requests.RequestException:
        # Never raises -- a missed heartbeat is exactly what the external
        # monitor (Healthchecks.io / Uptime Kuma push monitor) is watching
        # for, this job just doesn't need to also log every network hiccup.
        pass


def _send_cache_report() -> None:
    cfg = app_settings_store.get_settings()
    webhook_url = cfg.get("discord_webhook_url") or ""
    if not webhook_url or not cfg.get("report_enabled"):
        return

    summary = cache_report.build_report()
    discord_notifier.notify_cache_report(
        webhook_url,
        total_requests=summary["total_requests"],
        hit_ratio=summary["hit_ratio"],
        bandwidth_saved_bytes=summary["bandwidth_saved_bytes"],
        percent_used=summary["percent_used"],
        hours_until_full=summary["hours_until_full"],
    )


def reload_report_job() -> None:
    """Removes and re-adds the weekly report job with the current settings'
    weekday/hour/minute -- same remove-then-add pattern as reload_jobs()
    below, called after every settings save (routers/settings.py) so a
    changed schedule takes effect immediately rather than needing a
    restart."""
    cfg = app_settings_store.get_settings()
    existing = _scheduler.get_job(_REPORT_JOB_ID)
    if existing:
        existing.remove()
    if cfg.get("report_enabled"):
        _scheduler.add_job(
            _send_cache_report,
            trigger=CronTrigger(
                day_of_week=cfg.get("report_weekday", 0),
                hour=cfg.get("report_hour", 9),
                minute=cfg.get("report_minute", 0),
            ),
            id=_REPORT_JOB_ID,
            replace_existing=True,
        )


def reload_jobs() -> None:
    config = schedule_store.get_schedule()
    for service, entry in config.items():
        job_id = f"prefill-{service}"
        existing = _scheduler.get_job(job_id)
        if existing:
            existing.remove()
        if entry.get("enabled"):
            _scheduler.add_job(
                _run_job,
                trigger=CronTrigger(hour=entry.get("hour", 2), minute=entry.get("minute", 0)),
                args=[service],
                id=job_id,
                replace_existing=True,
            )


def start_and_reload() -> None:
    if not _scheduler.running:
        _scheduler.start()
    reload_jobs()
    reload_report_job()
    _scheduler.add_job(
        _check_disk_warning,
        trigger="interval",
        minutes=_DISK_WARNING_INTERVAL_MINUTES,
        id=_DISK_WARNING_JOB_ID,
        replace_existing=True,
    )
    _scheduler.add_job(
        _ping_heartbeat,
        trigger="interval",
        minutes=_HEARTBEAT_INTERVAL_MINUTES,
        id=_HEARTBEAT_JOB_ID,
        replace_existing=True,
    )


def shutdown() -> None:
    if _scheduler.running:
        _scheduler.shutdown(wait=False)
