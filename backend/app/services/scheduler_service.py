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
from datetime import datetime

import requests
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger

from app.services import (
    app_settings_store,
    backup_builder,
    cache_manager,
    cache_report,
    daily_stats_store,
    discord_notifier,
    notification_templates,
    ntfy_notifier,
    quiet_hours,
    records_store,
    schedule_store,
    webpush_notifier,
    webpush_subscriptions_store,
)
from app.services.cache_manager import CacheManagerError
from app.services.log_parser import aggregate_service_stats, iter_access_entries
from app.services.prefill_runner import PrefillRunnerError, trigger_prefill
from app.settings import settings

logger = logging.getLogger("cachepanel.scheduler")

_scheduler = BackgroundScheduler()

_DISK_WARNING_JOB_ID = "disk-warning-check"
_DISK_WARNING_THRESHOLD_PERCENT = 90
_DISK_WARNING_INTERVAL_MINUTES = 30

_REPORT_JOB_ID = "cache-report"

_HEARTBEAT_JOB_ID = "heartbeat-ping"
_HEARTBEAT_INTERVAL_MINUTES = 1
_HEARTBEAT_REQUEST_TIMEOUT = 5

_AUTO_BACKUP_JOB_ID = "auto-backup"

_AUTO_CLEANUP_JOB_ID = "auto-cleanup-check"
_AUTO_CLEANUP_INTERVAL_MINUTES = 360

_TRAFFIC_ALERT_JOB_ID = "traffic-alert-check"
_TRAFFIC_ALERT_INTERVAL_MINUTES = 30
_BYTES_PER_GB = 1024**3

_MONTHLY_BUDGET_JOB_ID = "monthly-budget-check"
_MONTHLY_BUDGET_INTERVAL_MINUTES = 60
_MONTHLY_BUDGET_WARN_PERCENT = 80

_RECORDS_SNAPSHOT_JOB_ID = "daily-records-snapshot"
# Below this many requests in a day, a hit-ratio "record" would be
# meaningless noise -- a quiet early morning with 2 requests and a lucky
# 100% shouldn't be able to "win" the all-time high-ratio record.
_RECORDS_MIN_REQUESTS_FOR_HIT_RATIO = 50

# Tracks whether a disk-warning notification has already fired for the
# *current* above-threshold spell, so a still-full disk doesn't re-notify
# every single interval -- only on the transition, and again after it drops
# back below the threshold and crosses it again.
_disk_warning_active = False

# Same idea as _disk_warning_active, but keyed per service -- several
# services can independently be above/below the traffic threshold at once,
# a single bool can't represent that.
_traffic_alert_active: dict[str, bool] = {}

# Which calendar month (YYYY-MM) the two monthly-budget flags below apply
# to -- reset whenever the current month no longer matches, so a new month
# always starts able to re-warn/re-exceed. In-memory only, not persisted:
# same "resets naturally on restart" trade-off _disk_warning_active and
# _traffic_alert_active already make, which just means a restart mid-month
# could in the worst case re-send one already-sent warning, never lose one.
_budget_state_month: str | None = None
_budget_warned = False
_budget_exceeded = False


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
    # Web push has no URL/topic to configure (see webpush_notifier.py --
    # it's per-device, opted into from Settings) -- whether any device is
    # currently subscribed is the only thing that decides if this channel
    # counts as "configured" for the early-exit below.
    has_webpush = bool(webpush_subscriptions_store.list_subscriptions())
    if not cfg.get("discord_notify_disk_warning") or (not webhook_url and not ntfy_topic and not has_webpush):
        return

    try:
        usage = cache_manager.get_disk_usage()
    except CacheManagerError:
        logger.exception("Disk-warning check could not read disk usage")
        return

    if usage.percent_used >= _DISK_WARNING_THRESHOLD_PERCENT:
        if not _disk_warning_active:
            # Deliberately NOT quiet-hours-suppressed -- see quiet_hours.py's
            # own docstring: a near-full cache disk is treated as critical.
            template = notification_templates.render(
                "disk_warning", cfg.get("notification_templates") or {}, percent=f"{usage.percent_used:.0f}"
            )
            if webhook_url:
                discord_notifier.notify_disk_warning(webhook_url, usage.percent_used, template=template)
            if ntfy_topic:
                ntfy_notifier.notify_disk_warning(
                    cfg.get("ntfy_server_url") or "", ntfy_topic, usage.percent_used, template=template
                )
            webpush_notifier.notify_disk_warning(usage.percent_used, template=template)
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
    if not cfg.get("report_enabled"):
        return
    # Routine, not urgent -- suppressed during quiet hours (see
    # quiet_hours.py's own docstring for the full reasoning).
    if quiet_hours.is_quiet_now(cfg):
        return

    summary = cache_report.build_report()
    template = notification_templates.render(
        "weekly_report",
        cfg.get("notification_templates") or {},
        requests=f"{summary['total_requests']:,}",
        hit_ratio=f"{summary['hit_ratio'] * 100:.0f}",
        bandwidth_saved=discord_notifier.format_bytes(summary["bandwidth_saved_bytes"]),
    )

    webhook_url = cfg.get("discord_webhook_url") or ""
    if webhook_url:
        discord_notifier.notify_cache_report(
            webhook_url,
            total_requests=summary["total_requests"],
            hit_ratio=summary["hit_ratio"],
            bandwidth_saved_bytes=summary["bandwidth_saved_bytes"],
            percent_used=summary["percent_used"],
            hours_until_full=summary["hours_until_full"],
            template=template,
        )
    # Web push report is intentionally simpler (no disk/forecast line) --
    # see webpush_notifier.notify_cache_report()'s own signature; a no-op
    # if no device is subscribed.
    webpush_notifier.notify_cache_report(
        total_requests=summary["total_requests"],
        hit_ratio=summary["hit_ratio"],
        bandwidth_saved_gb=summary["bandwidth_saved_bytes"] / _BYTES_PER_GB,
        template=template,
    )


def _run_auto_backup() -> None:
    cfg = app_settings_store.get_settings()
    if not cfg.get("auto_backup_enabled"):
        return
    try:
        backup_builder.write_auto_backup(cfg.get("auto_backup_retention", 7))
    except OSError:
        logger.exception("Automatic backup failed")


def _run_auto_cleanup_check() -> None:
    cfg = app_settings_store.get_settings()
    if not cfg.get("auto_clean_corruption_enabled"):
        return
    # The cleanup itself still runs on schedule regardless of quiet hours
    # (it's a scan+delete, not a notification) -- only the after-the-fact
    # notice below is what quiet hours suppresses.
    quiet = quiet_hours.is_quiet_now(cfg)

    try:
        scan = cache_manager.scan_for_corruption()
    except CacheManagerError:
        logger.exception("Auto-cleanup check could not scan for corruption")
        return
    if scan.corrupt_file_count == 0:
        return

    try:
        cache_manager.clean_corrupted_files()
    except CacheManagerError:
        logger.exception("Auto-cleanup could not delete corrupted files")
        return

    if quiet:
        return

    webhook_url = cfg.get("discord_webhook_url") or ""
    ntfy_topic = cfg.get("ntfy_topic") or ""
    if webhook_url:
        discord_notifier.notify_auto_cleanup(webhook_url, scan.corrupt_file_count)
    if ntfy_topic:
        ntfy_notifier.notify_auto_cleanup(cfg.get("ntfy_server_url") or "", ntfy_topic, scan.corrupt_file_count)
    webpush_notifier.notify_auto_cleanup(scan.corrupt_file_count)


def _check_traffic_alert() -> None:
    cfg = app_settings_store.get_settings()
    threshold_gb = cfg.get("traffic_alert_threshold_gb") or 0
    if not threshold_gb:
        _traffic_alert_active.clear()
        return

    webhook_url = cfg.get("discord_webhook_url") or ""
    ntfy_topic = cfg.get("ntfy_topic") or ""
    has_webpush = bool(webpush_subscriptions_store.list_subscriptions())
    if not webhook_url and not ntfy_topic and not has_webpush:
        return

    access_path = settings.lancache_log_dir / "access.log"
    entries = iter_access_entries(access_path, max_lines=100_000)
    stats_by_service = aggregate_service_stats(entries)
    threshold_bytes = threshold_gb * _BYTES_PER_GB
    quiet = quiet_hours.is_quiet_now(cfg)
    templates = cfg.get("notification_templates") or {}

    seen_services = set()
    for service, stat in stats_by_service.items():
        seen_services.add(service)
        total_bytes = stat.hit_bytes + stat.miss_bytes
        if total_bytes >= threshold_bytes:
            if not _traffic_alert_active.get(service):
                gb_used = total_bytes / _BYTES_PER_GB
                # Routine threshold notice, not urgent -- suppressed during
                # quiet hours (see quiet_hours.py). The active-flag still
                # flips below either way, so a spell that started (and
                # would have alerted) during quiet hours doesn't re-alert
                # the moment the window ends for traffic that hasn't changed.
                if not quiet:
                    template = notification_templates.render(
                        "traffic_alert",
                        templates,
                        service=service,
                        gb_used=f"{gb_used:.1f}",
                        threshold_gb=f"{threshold_gb:.1f}",
                    )
                    if webhook_url:
                        discord_notifier.notify_traffic_alert(webhook_url, service, gb_used, threshold_gb, template=template)
                    if ntfy_topic:
                        ntfy_notifier.notify_traffic_alert(
                            cfg.get("ntfy_server_url") or "", ntfy_topic, service, gb_used, threshold_gb, template=template
                        )
                    webpush_notifier.notify_traffic_alert(service, gb_used, threshold_gb, template=template)
                _traffic_alert_active[service] = True
        else:
            _traffic_alert_active[service] = False

    # A service that dropped out of the log tail entirely (no recent
    # activity at all) should also reset, so a later resurgence can alert
    # again rather than staying silently "already active" forever.
    for service in list(_traffic_alert_active):
        if service not in seen_services:
            _traffic_alert_active.pop(service, None)


def _check_monthly_budget() -> None:
    """Warns at _MONTHLY_BUDGET_WARN_PERCENT and again on exceeding 100%
    of a configured monthly bandwidth-saved budget, each once per calendar
    month. Reads daily_stats_store.py's real per-day running total for the
    current month, NOT log_parser.py's bounded log-tail aggregation -- see
    daily_stats_store.get_month_total()'s own docstring for why that
    distinction matters here specifically (a month is far wider than what
    the tail read reliably covers)."""
    global _budget_state_month, _budget_warned, _budget_exceeded

    cfg = app_settings_store.get_settings()
    budget_gb = cfg.get("monthly_budget_gb") or 0
    if not budget_gb:
        return

    current_month = datetime.now().strftime("%Y-%m")
    if current_month != _budget_state_month:
        _budget_state_month = current_month
        _budget_warned = False
        _budget_exceeded = False

    totals = daily_stats_store.get_month_total(current_month)
    gb_used = totals["hit_bytes"] / _BYTES_PER_GB
    percent = (gb_used / budget_gb) * 100 if budget_gb else 0.0

    webhook_url = cfg.get("discord_webhook_url") or ""
    ntfy_topic = cfg.get("ntfy_topic") or ""
    has_webpush = bool(webpush_subscriptions_store.list_subscriptions())
    if not webhook_url and not ntfy_topic and not has_webpush:
        return
    # Informational, not urgent -- suppressed during quiet hours (see
    # quiet_hours.py's own docstring).
    if quiet_hours.is_quiet_now(cfg):
        return

    def _fire(exceeded: bool) -> None:
        if webhook_url:
            discord_notifier.notify_monthly_budget(webhook_url, gb_used, budget_gb, percent, exceeded)
        if ntfy_topic:
            ntfy_notifier.notify_monthly_budget(
                cfg.get("ntfy_server_url") or "", ntfy_topic, gb_used, budget_gb, percent, exceeded
            )
        webpush_notifier.notify_monthly_budget(gb_used, budget_gb, percent, exceeded)

    if percent >= 100 and not _budget_exceeded:
        _fire(exceeded=True)
        _budget_exceeded = True
        _budget_warned = True  # exceeding implies the warn threshold was also crossed
    elif percent >= _MONTHLY_BUDGET_WARN_PERCENT and not _budget_warned:
        _fire(exceeded=False)
        _budget_warned = True


def _run_daily_records_snapshot() -> None:
    """Once a day (see start_and_reload()'s fixed 23:55 CronTrigger --
    unlike the other jobs in this file, this one isn't settings-driven, so
    it has no reload_*_job() counterpart), takes today's cumulative stats
    from the current log tail and (a) updates records_store.py's two
    records if today set a new high, and (b) appends today's row to
    daily_stats_store.py's long-term trend history. Both reuse the same
    single log-tail read/aggregation below rather than each doing their
    own -- see records_store.py's and daily_stats_store.py's own docstrings
    for the honest caveat about what "today's total" means when it's read
    from a bounded log tail rather than a real per-day counter."""
    access_path = settings.lancache_log_dir / "access.log"
    entries = iter_access_entries(access_path, max_lines=100_000)

    today = datetime.now().astimezone().date()
    todays_entries = [e for e in entries if e.timestamp.date() == today]
    if not todays_entries:
        return

    stats_by_service = aggregate_service_stats(todays_entries)
    total_hit_bytes = sum(s.hit_bytes for s in stats_by_service.values())
    total_miss_bytes = sum(s.miss_bytes for s in stats_by_service.values())
    total_hit_count = sum(s.hit_count for s in stats_by_service.values())
    total_miss_count = sum(s.miss_count for s in stats_by_service.values())
    total_requests = total_hit_count + total_miss_count

    date_str = today.isoformat()
    records_store.record_bandwidth_saved(total_hit_bytes, date_str)
    if total_requests >= _RECORDS_MIN_REQUESTS_FOR_HIT_RATIO:
        records_store.record_hit_ratio(total_hit_count / total_requests, date_str)

    daily_stats_store.record_day(date_str, total_hit_bytes, total_miss_bytes, total_requests)


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


def reload_auto_backup_job() -> None:
    """Same remove-then-add pattern as reload_report_job() -- called after
    every settings save so a changed backup schedule takes effect
    immediately."""
    cfg = app_settings_store.get_settings()
    existing = _scheduler.get_job(_AUTO_BACKUP_JOB_ID)
    if existing:
        existing.remove()
    if cfg.get("auto_backup_enabled"):
        _scheduler.add_job(
            _run_auto_backup,
            trigger=CronTrigger(
                day_of_week=cfg.get("auto_backup_weekday", 0),
                hour=cfg.get("auto_backup_hour", 3),
                minute=cfg.get("auto_backup_minute", 0),
            ),
            id=_AUTO_BACKUP_JOB_ID,
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
    reload_auto_backup_job()
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
    _scheduler.add_job(
        _run_auto_cleanup_check,
        trigger="interval",
        minutes=_AUTO_CLEANUP_INTERVAL_MINUTES,
        id=_AUTO_CLEANUP_JOB_ID,
        replace_existing=True,
    )
    _scheduler.add_job(
        _check_traffic_alert,
        trigger="interval",
        minutes=_TRAFFIC_ALERT_INTERVAL_MINUTES,
        id=_TRAFFIC_ALERT_JOB_ID,
        replace_existing=True,
    )
    _scheduler.add_job(
        _check_monthly_budget,
        trigger="interval",
        minutes=_MONTHLY_BUDGET_INTERVAL_MINUTES,
        id=_MONTHLY_BUDGET_JOB_ID,
        replace_existing=True,
    )
    _scheduler.add_job(
        _run_daily_records_snapshot,
        trigger=CronTrigger(hour=23, minute=55),
        id=_RECORDS_SNAPSHOT_JOB_ID,
        replace_existing=True,
    )


def shutdown() -> None:
    if _scheduler.running:
        _scheduler.shutdown(wait=False)
