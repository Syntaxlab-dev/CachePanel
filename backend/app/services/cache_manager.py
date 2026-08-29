"""Clearing the LanCache disk cache.

Investigated and deliberately NOT implemented: per-service purge. lancache
(lancachenet/monolithic) uses a single nginx `proxy_cache_path` zone with
`levels=2:2` and `proxy_cache_key $cacheidentifier$uri$slice_range` -- the
key (which does include the per-service identifier) gets MD5-hashed into
an opaque two-level hex directory tree
(`/data/cache/cache/<xx>/<yy>/<hash>`), so there is no on-disk grouping by
service to safely delete. Reproducing nginx's exact cache-key hashing
per-entry to compute which files belong to a given service would be
fragile (easy to get subtly wrong) and the failure mode is silently
deleting the wrong files -- not acceptable for a self-hosted tool without
a very high confidence implementation, which is out of scope here. So:
only a full cache clear is offered, and the frontend must confirm it
explicitly since it affects every service, not just one.
"""

from dataclasses import dataclass

from docker.errors import DockerException, NotFound

import docker

from app.settings import settings


class CacheManagerError(RuntimeError):
    pass


def clear_entire_cache() -> str:
    try:
        client = docker.DockerClient(base_url=settings.docker_socket)
        container = client.containers.get("lancache")
    except NotFound as exc:
        raise CacheManagerError("lancache container not found") from exc
    except DockerException as exc:
        raise CacheManagerError(f"Could not reach Docker daemon: {exc}") from exc

    # Clear only the cache *contents* directory, not CONFIGHASH (nginx's
    # own marker for whether proxy_cache_path config changed) or the
    # /data/cache parent itself.
    exit_code, output = container.exec_run(
        ["sh", "-c", "rm -rf /data/cache/cache/* && echo cleared"], demux=False
    )
    if exit_code != 0:
        raise CacheManagerError(f"Clearing cache failed: {output.decode('utf-8', errors='replace')}")

    # Restart so nginx's in-memory keys_zone index gets rebuilt cleanly
    # against the now-empty directory, rather than relying on it to
    # self-heal lazily.
    container.restart(timeout=30)

    return "Cache geleert, lancache neu gestartet."


# Corruption scan, deliberately narrow in scope: only 0-byte files are
# flagged. Investigated and rejected: flagging "unusually small" or
# "old-looking" files as corrupt too. lancache's nginx config here has
# use_temp_path=off (confirmed live: /etc/nginx/conf.d/20_proxy_cache_path.conf
# on the real container), meaning nginx writes a response into its FINAL
# cache-path location while still downloading it, then renames it in place
# once complete -- so a file that's merely small or has an old mtime cannot
# be reliably told apart from a legitimately tiny cached response (e.g. a
# small manifest/metadata request) without also being able to tell it apart
# from an active in-progress download. A 0-byte file has no such ambiguity:
# nginx never legitimately produces one, so it's always either a crashed
# write or leftover corruption -- safe to detect and safe to delete.
_CACHE_DIR_IN_CONTAINER = "/data/cache/cache"


@dataclass
class CorruptionScanResult:
    corrupt_file_count: int
    sample_paths: list[str]  # first few paths, for display -- not exhaustive
    truncated: bool


def _get_lancache_container():
    try:
        client = docker.DockerClient(base_url=settings.docker_socket)
        return client.containers.get("lancache")
    except NotFound as exc:
        raise CacheManagerError("lancache container not found") from exc
    except DockerException as exc:
        raise CacheManagerError(f"Could not reach Docker daemon: {exc}") from exc


def scan_for_corruption(sample_limit: int = 20) -> CorruptionScanResult:
    container = _get_lancache_container()
    # Two-pass: a cheap total count via wc -l, then a capped sample of paths
    # for display -- the cache can hold millions of files, so we never want
    # to pull the full list back through the Docker API.
    count_exit, count_output = container.exec_run(
        ["sh", "-c", f"find {_CACHE_DIR_IN_CONTAINER} -type f -size 0 | wc -l"], demux=False
    )
    if count_exit != 0:
        raise CacheManagerError(f"Scan fehlgeschlagen: {count_output.decode('utf-8', errors='replace')}")
    total = int(count_output.decode().strip() or "0")

    sample: list[str] = []
    if total > 0:
        sample_exit, sample_output = container.exec_run(
            ["sh", "-c", f"find {_CACHE_DIR_IN_CONTAINER} -type f -size 0 | head -n {sample_limit}"],
            demux=False,
        )
        if sample_exit == 0:
            sample = [line for line in sample_output.decode(errors="replace").splitlines() if line]

    return CorruptionScanResult(corrupt_file_count=total, sample_paths=sample, truncated=total > len(sample))


def clean_corrupted_files() -> str:
    container = _get_lancache_container()
    # Re-scoped to the exact same criterion as scan_for_corruption() --
    # server-computed, not a client-supplied path list, so there is no way
    # for a caller to make this delete anything outside the 0-byte set.
    exit_code, output = container.exec_run(
        ["sh", "-c", f"find {_CACHE_DIR_IN_CONTAINER} -type f -size 0 -delete -print | wc -l"],
        demux=False,
    )
    if exit_code != 0:
        raise CacheManagerError(f"Bereinigung fehlgeschlagen: {output.decode('utf-8', errors='replace')}")
    deleted = int(output.decode().strip() or "0")

    # Same reasoning as clear_entire_cache(): don't leave nginx's in-memory
    # keys_zone index pointing at files that no longer exist.
    container.restart(timeout=30)

    return f"{deleted} beschädigte Datei(en) entfernt, lancache neu gestartet."
