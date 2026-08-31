"""Upcoming Steam releases, sorted by wishlist/popularity -- an awareness
tool, NOT a pre-caching feature: an unreleased game has no LanCache-cacheable
depot data yet (Steam doesn't open a title's CDN depots until launch, aside
from the rare publisher-enabled true pre-load, which isn't detectable from
this data source and isn't claimed here), so all this does is let an admin
see what's coming and manually plan around a release's own day -- e.g.
tightening the prefill schedule or just being ready for the traffic.

Data source: Steam's own store search page, filtered to
`popularcomingsoon` -- the same endpoint store.steampowered.com's own
"Coming Soon" tab uses, ordered by anticipation, not just chronologically
(the alternative, unfiltered `comingsoon`, is mostly shovelware). There is
no documented, keyless JSON API for this (Valve's public search AJAX
endpoint in this environment consistently served the full HTML page rather
than the lightweight JSON variant regardless of headers sent -- verified
live, not assumed), so this scrapes the same server-rendered result rows a
browser would get from the identical URL. Regex-based, not an HTML parser
dependency, matching this project's existing minimal-dependency style --
and deliberately tolerant: a markup change on Steam's side degrades to an
empty list (see fetch()'s own try/except), never a crash or a stale-forever
result, since retry_after in the cache means the next request tries again
naturally.

Cached to disk (same file-cache shape as cover_art.py) for
_CACHE_TTL_SECONDS -- release lists shift by, at most, a few entries a day,
so re-scraping on every dashboard load would just be rude to Steam for no
benefit.
"""

import html
import json
import os
import re
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from threading import Lock
from datetime import datetime, timezone

import requests

_CACHE_PATH = Path(os.environ.get("UPCOMING_RELEASES_CACHE_PATH", "/data/upcoming_releases_cache.json"))
_lock = Lock()

_CACHE_TTL_SECONDS = 6 * 3600
_REQUEST_TIMEOUT = 10
_SEARCH_URL = (
    "https://store.steampowered.com/search/results/"
    "?query&start=0&count=25&dynamic_data=&sort_by=_ASC&filter=popularcomingsoon&cc=us&l=en"
)
_MAX_WINDOW_DAYS = 60

_ROW_RE = re.compile(r'<a[^>]*data-ds-appid="(\d+)"[^>]*>(.*?)</a>', re.S)
_TITLE_RE = re.compile(r'search_name[^>]*>.*?<span[^>]*>([^<]+)</span>', re.S)
_DATE_RE = re.compile(r'search_released[^>]*>([^<]*)<', re.S)


@dataclass
class UpcomingRelease:
    app_id: int
    name: str
    release_date: str  # ISO date, e.g. "2026-09-02"
    header_image: str
    store_url: str


def _parse_release_date(raw: str) -> str | None:
    """Steam's own date text -- 'Sep 2, 2026' for a firm date, but also
    vague forms like 'Q4 2026' / 'Coming Soon' / '2026' for titles without
    one yet. Only firm day-level dates are usable here (the whole point is
    a day-focused planning list), so anything else is dropped rather than
    guessed at."""
    text = raw.strip()
    for fmt in ("%b %d, %Y", "%d %b, %Y"):
        try:
            return datetime.strptime(text, fmt).date().isoformat()
        except ValueError:
            continue
    return None


def _fetch_live() -> list[UpcomingRelease]:
    try:
        resp = requests.get(
            _SEARCH_URL,
            headers={"User-Agent": "Mozilla/5.0 (CachePanel upcoming-releases fetch)"},
            timeout=_REQUEST_TIMEOUT,
        )
        resp.raise_for_status()
        page_html = resp.text
    except requests.RequestException:
        return []

    releases: list[UpcomingRelease] = []
    for app_id_str, block in _ROW_RE.findall(page_html):
        title_match = _TITLE_RE.search(block)
        date_match = _DATE_RE.search(block)
        if not title_match or not date_match:
            continue
        release_date = _parse_release_date(date_match.group(1))
        if release_date is None:
            continue
        app_id = int(app_id_str)
        releases.append(
            UpcomingRelease(
                app_id=app_id,
                name=html.unescape(title_match.group(1).strip()),
                release_date=release_date,
                header_image=f"https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/{app_id}/header.jpg",
                store_url=f"https://store.steampowered.com/app/{app_id}",
            )
        )
    return releases


def _load_cache() -> dict | None:
    if not _CACHE_PATH.exists():
        return None
    try:
        return json.loads(_CACHE_PATH.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError, OSError):
        return None


def _save_cache(releases: list[UpcomingRelease]) -> None:
    try:
        _CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
        _CACHE_PATH.write_text(
            json.dumps({"fetched_at": time.time(), "releases": [asdict(r) for r in releases]}),
            encoding="utf-8",
        )
    except OSError:
        pass  # a stale/missing cache just means the next call re-fetches; not fatal


def get_upcoming_releases(days: int = _MAX_WINDOW_DAYS) -> list[dict]:
    """Newest-fetch-first is irrelevant here -- results are always
    returned sorted by release_date ascending (soonest first), regardless
    of cache freshness, so the list reads naturally regardless of when the
    underlying scrape last ran."""
    with _lock:
        cached = _load_cache()
        if cached and time.time() - cached.get("fetched_at", 0) < _CACHE_TTL_SECONDS:
            releases = [UpcomingRelease(**r) for r in cached["releases"]]
        else:
            releases = _fetch_live()
            if releases:
                _save_cache(releases)
            elif cached:
                # Live fetch failed/empty -- fall back to the last good
                # cache rather than showing nothing, even if it's stale.
                releases = [UpcomingRelease(**r) for r in cached["releases"]]

    window_days = max(1, min(days, _MAX_WINDOW_DAYS))
    today = datetime.now(timezone.utc).date()
    cutoff = today.toordinal() + window_days

    def in_window(r: UpcomingRelease) -> bool:
        d = datetime.fromisoformat(r.release_date).date()
        return today.toordinal() <= d.toordinal() <= cutoff

    filtered = sorted((r for r in releases if in_window(r)), key=lambda r: r.release_date)
    return [asdict(r) for r in filtered]
