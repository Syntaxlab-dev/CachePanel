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
