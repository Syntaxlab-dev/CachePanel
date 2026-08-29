"""Cover art lookup via SteamGridDB (https://www.steamgriddb.com/api/v2),
entirely optional: with no API key configured every function below returns
None immediately, so the Steam/Battle.net pages behave exactly as before
this wave, just without artwork -- same "blank = feature off" contract as
LANCACHE_IP in health.py.

Results are cached on disk (/data/cover_art_cache.json) because SteamGridDB
has rate limits, and even without a hard limit it would be rude to hit
their API on every single page load. Hits are cached far longer than
misses -- a "no artwork found" result might become true later (someone
adds the game to the site), so it's retried sooner than a confirmed result.
"""

import json
import os
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Lock
from urllib.parse import quote

import requests

_CACHE_PATH = Path(os.environ.get("COVER_ART_CACHE_PATH", "/data/cover_art_cache.json"))
_lock = Lock()

_HIT_TTL_SECONDS = 30 * 24 * 3600
_MISS_TTL_SECONDS = 24 * 3600
_BASE_URL = "https://www.steamgriddb.com/api/v2"
_REQUEST_TIMEOUT = 5

# Bounds how many *uncached* SteamGridDB lookups a single request will do --
# a cold cache on a large Steam library shouldn't turn one page load into
# hundreds of sequential/concurrent external calls. The rest resolve on
# later page loads as the cache warms up.
_MAX_UNCACHED_PER_REQUEST = 60


def _load_cache() -> dict:
    if not _CACHE_PATH.exists():
        return {}
    try:
        return json.loads(_CACHE_PATH.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError, OSError):
        return {}


def _save_cache(cache: dict) -> None:
    try:
        _CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
        _CACHE_PATH.write_text(json.dumps(cache), encoding="utf-8")
    except OSError:
        pass  # cover art is a nice-to-have; never let a disk hiccup break a caller


def _cache_get(key: str) -> tuple[bool, str | None]:
    with _lock:
        entry = _load_cache().get(key)
    if not entry:
        return False, None
    ttl = _HIT_TTL_SECONDS if entry.get("url") else _MISS_TTL_SECONDS
    if time.time() - entry.get("ts", 0) > ttl:
        return False, None
    return True, entry.get("url")


def _cache_set(key: str, url: str | None) -> None:
    with _lock:
        cache = _load_cache()
        cache[key] = {"url": url, "ts": time.time()}
        _save_cache(cache)


def _headers(api_key: str) -> dict:
    return {"Authorization": f"Bearer {api_key}"}


def _best_grid_url(grids: list[dict]) -> str | None:
    # Prefer portrait-ish grids (the common "box art" shape) over the
    # landscape grids SteamGridDB also returns for the same game.
    portrait = [g for g in grids if g.get("height", 0) > g.get("width", 0)]
    pick = (portrait or grids)[0] if grids else None
    return pick.get("url") if pick else None


def get_cover_for_steam_app(app_id: int, api_key: str) -> str | None:
    if not api_key:
        return None
    cache_key = f"steam:{app_id}"
    hit, cached = _cache_get(cache_key)
    if hit:
        return cached

    url = None
    try:
        resp = requests.get(f"{_BASE_URL}/grids/steam/{app_id}", headers=_headers(api_key), timeout=_REQUEST_TIMEOUT)
        if resp.status_code == 200:
            url = _best_grid_url(resp.json().get("data", []))
    except (requests.RequestException, ValueError):
        url = None

    _cache_set(cache_key, url)
    return url


def get_cover_by_name(name: str, api_key: str) -> str | None:
    """Best-effort: search SteamGridDB by name and use its top match. Used
    for Battle.net (small fixed catalog, no numeric Steam-style app ID to
    look up directly)."""
    if not api_key or not name:
        return None
    cache_key = f"name:{name.strip().lower()}"
    hit, cached = _cache_get(cache_key)
    if hit:
        return cached

    url = None
    try:
        search_resp = requests.get(
            f"{_BASE_URL}/search/autocomplete/{quote(name)}", headers=_headers(api_key), timeout=_REQUEST_TIMEOUT
        )
        if search_resp.status_code == 200:
            results = search_resp.json().get("data", [])
            if results:
                grid_resp = requests.get(
                    f"{_BASE_URL}/grids/game/{results[0]['id']}",
                    headers=_headers(api_key),
                    timeout=_REQUEST_TIMEOUT,
                )
                if grid_resp.status_code == 200:
                    url = _best_grid_url(grid_resp.json().get("data", []))
    except (requests.RequestException, ValueError, KeyError, IndexError):
        url = None

    _cache_set(cache_key, url)
    return url


def enrich_steam_games(games: list[dict], api_key: str) -> None:
    """Mutates each dict in `games` in place, adding a `cover_url` key.
    No-op (all None) if no key is configured."""
    if not api_key:
        for g in games:
            g["cover_url"] = None
        return

    to_fetch = []
    for g in games:
        hit, cached = _cache_get(f"steam:{g['app_id']}")
        g["cover_url"] = cached if hit else None
        if not hit:
            to_fetch.append(g)

    batch = to_fetch[:_MAX_UNCACHED_PER_REQUEST]
    if not batch:
        return
    with ThreadPoolExecutor(max_workers=8) as pool:
        urls = pool.map(lambda g: get_cover_for_steam_app(g["app_id"], api_key), batch)
        for g, url in zip(batch, urls):
            g["cover_url"] = url


def enrich_by_name(items: list[dict], name_field: str, api_key: str) -> None:
    """Mutates each dict in `items` in place, adding a `cover_url` key,
    looked up by `item[name_field]`. No-op (all None) if no key is
    configured."""
    if not api_key:
        for it in items:
            it["cover_url"] = None
        return

    with ThreadPoolExecutor(max_workers=8) as pool:
        urls = list(pool.map(lambda it: get_cover_by_name(it[name_field], api_key), items))
    for it, url in zip(items, urls):
        it["cover_url"] = url
