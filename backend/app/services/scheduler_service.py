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

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger

from app.services import app_settings_store, cache_manager, discord_notifier, schedule_store
from app.services.cache_manager import CacheManagerError
from app.services.prefill_runner import PrefillRunnerError, trigger_prefill

logger = logging.getLogger("cachepanel.scheduler")

_scheduler = BackgroundScheduler()

_DISK_WARNING_JOB_ID = "disk-warning-check"
_DISK_WARNING_THRESHOLD_PERCENT = 90
_DISK_WARNING_INTERVAL_MINUTES = 30

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
    if not webhook_url or not cfg.get("discord_notify_disk_warning"):
        return

    try:
        usage = cache_manager.get_disk_usage()
    except CacheManagerError:
        logger.exception("Disk-warning check could not read disk usage")
        return

    if usage.percent_used >= _DISK_WARNING_THRESHOLD_PERCENT:
        if not _disk_warning_active:
            discord_notifier.notify_disk_warning(webhook_url, usage.percent_used)
            _disk_warning_active = True
    else:
        _disk_warning_active = False


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
    _scheduler.add_job(
        _check_disk_warning,
        trigger="interval",
        minutes=_DISK_WARNING_INTERVAL_MINUTES,
        id=_DISK_WARNING_JOB_ID,
        replace_existing=True,
    )


def shutdown() -> None:
    if _scheduler.running:
        _scheduler.shutdown(wait=False)
