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

from app.services import schedule_store
from app.services.prefill_runner import PrefillRunnerError, trigger_prefill

logger = logging.getLogger("cachepanel.scheduler")

_scheduler = BackgroundScheduler()


def _run_job(service: str) -> None:
    try:
        trigger_prefill(service)
    except PrefillRunnerError:
        logger.exception("Scheduled prefill run failed for service=%s", service)


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


def shutdown() -> None:
    if _scheduler.running:
        _scheduler.shutdown(wait=False)
