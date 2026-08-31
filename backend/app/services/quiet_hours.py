"""Quiet-hours suppression for non-critical notifications (Discord/ntfy/web
push), 4th feature round Welle 3.

What counts as "critical" (never suppressed) vs. suppressed during the
configured window, decided here rather than left to each caller:
- Disk-space warning: stays critical. A full cache disk breaks prefill runs
  outright: this is closer to an operational alarm than a status update,
  and by the time it fires (default 90%) waiting until morning risks the
  disk actually filling before anyone sees it.
- Prefill FAILURE: stays critical. An actionable error a user would want
  to investigate, not routine noise -- structurally the same reasoning as
  the disk warning.
- Prefill success, the weekly cache report, the auto-cleanup notice, and
  the traffic-threshold alert are all suppressed. None of them represent a
  problem needing attention overnight; they can wait until the window ends.
- Monthly-budget warnings (4th round, Welle 3, added alongside this
  module) follow the same "suppressed" bucket -- a budget approaching its
  limit is informational, not an emergency the way a full disk is.

Suppression here means "dropped", not "queued for later delivery" -- a
digest/replay mechanism would need its own persistent queue and a delivery
job, which is more machinery than the four notification events this
protects actually warrant. A user who wants to know what happened
overnight already has run_history_store.py's history and the audit log
(see audit_log_store.py) to check in the morning.

No per-installation timezone setting -- like every other time-of-day
setting in this project (report_hour/minute, auto_backup_hour/minute), this
compares against the server's own local time via datetime.now(), not a
configurable timezone. Consistent with the existing schedule fields rather
than a special case.
"""

from datetime import datetime, time


def is_quiet_now(cfg: dict) -> bool:
    if not cfg.get("quiet_hours_enabled"):
        return False

    start = time(int(cfg.get("quiet_hours_start_hour", 22)), int(cfg.get("quiet_hours_start_minute", 0)))
    end = time(int(cfg.get("quiet_hours_end_hour", 8)), int(cfg.get("quiet_hours_end_minute", 0)))

    # A zero-width window (start == end) is treated as "off" rather than
    # "always quiet" -- the more surprising of the two silent failure modes
    # for a misconfigured pair of equal times would be every notification
    # going dark with no visible cause.
    if start == end:
        return False

    now = datetime.now().time()
    if start < end:
        return start <= now < end
    # Overnight wrap, e.g. 22:00-08:00: quiet from start through midnight,
    # AND from midnight through end.
    return now >= start or now < end
