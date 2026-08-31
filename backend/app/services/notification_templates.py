"""User-editable text templates for the five existing notification events
(prefill success/failure, disk warning, traffic alert, weekly report),
4th feature round Welle 3.

Deliberately channel-agnostic: a customized template renders once as plain
text and that same string is sent to Discord/ntfy/web-push alike, unlike
each channel's own hardcoded default (discord_notifier.py's defaults use
Discord markdown -- **bold**, emoji shortcodes -- ntfy/webpush's don't).
Discord's webhook API still renders any markdown a user happens to type
into their own custom template; ntfy/webpush just display those characters
literally. That's an accepted, documented trade-off for having exactly one
template per event instead of three -- covering every event separately per
channel would be 5x3 fields for a feature nobody asked to be that granular.

render() returns None (not the hardcoded default) when nothing has been
customized for that event -- callers keep using their own existing
hardcoded f-string in that case, so a fresh install's notification text is
byte-for-byte unchanged from before this feature existed.
"""

TEMPLATES: dict[str, dict] = {
    "prefill_success": {
        "placeholders": {"service", "duration"},
        "default": "{service} prefill finished successfully in {duration}s.",
    },
    "prefill_failure": {
        "placeholders": {"service", "exit_code"},
        "default": "{service} prefill failed (exit code {exit_code}).",
    },
    "disk_warning": {
        "placeholders": {"percent"},
        "default": "LanCache disk is {percent}% full. Consider clearing old cache data in CachePanel.",
    },
    "traffic_alert": {
        "placeholders": {"service", "gb_used", "threshold_gb"},
        "default": "{service} traffic in the last 24h ({gb_used} GB) crossed the configured alert threshold "
        "({threshold_gb} GB).",
    },
    "weekly_report": {
        "placeholders": {"requests", "hit_ratio", "bandwidth_saved"},
        "default": "{requests} requests, {hit_ratio}% served from cache. Bandwidth saved: {bandwidth_saved}.",
    },
}

# Sample values for the Settings page's "preview" button -- picked to look
# like plausible real data, not zeros/placeholders, so a preview actually
# reads like a real notification would.
PREVIEW_VALUES: dict[str, dict] = {
    "prefill_success": {"service": "steam", "duration": "42"},
    "prefill_failure": {"service": "battlenet", "exit_code": "1"},
    "disk_warning": {"percent": "92"},
    "traffic_alert": {"service": "epic", "gb_used": "12.4", "threshold_gb": "10.0"},
    "weekly_report": {"requests": "3,214", "hit_ratio": "87", "bandwidth_saved": "48.2 GB"},
}


class TemplateError(ValueError):
    pass


def validate(event_key: str, template: str) -> None:
    """Raises TemplateError if `template` references a placeholder that
    doesn't exist for this event, or isn't syntactically a valid
    str.format() template at all. Called from routers/settings.py before a
    template is ever saved -- an invalid template should never make it
    into storage, let alone be discovered for the first time when a real
    notification tries to use it."""
    if event_key not in TEMPLATES:
        raise TemplateError(f"Unknown notification event '{event_key}'.")
    allowed = TEMPLATES[event_key]["placeholders"]
    try:
        used = {field_name for _, field_name, _, _ in _string_format_fields(template) if field_name}
    except ValueError as exc:
        raise TemplateError(f"Malformed template: {exc}") from exc
    unknown = used - allowed
    if unknown:
        raise TemplateError(
            f"Unknown placeholder(s) {sorted(unknown)} for this event. Allowed: {sorted(allowed)}."
        )


def _string_format_fields(template: str):
    import string

    return string.Formatter().parse(template)


def render(event_key: str, custom_templates: dict | None, **values: object) -> str | None:
    """Returns the rendered custom template for this event, or None if no
    custom template is configured (caller should fall back to its own
    hardcoded default text in that case). Falls back to this module's own
    default template -- NOT the caller's hardcoded string, since that's
    private to each caller -- if the stored template fails to render for
    any reason (e.g. a value wasn't supplied), so a bad save can never
    crash a real notification."""
    template = (custom_templates or {}).get(event_key)
    if not template:
        return None
    try:
        return template.format(**values)
    except (KeyError, IndexError, ValueError):
        return TEMPLATES[event_key]["default"].format(**values)


def preview(event_key: str, template: str) -> str:
    """Renders `template` (not necessarily saved yet) against fixed sample
    values -- used by the Settings page's preview button. Raises
    TemplateError via validate() first so a preview of an invalid template
    gives the same clear error a save attempt would, rather than a
    best-effort fallback render."""
    validate(event_key, template)
    return template.format(**PREVIEW_VALUES[event_key])
