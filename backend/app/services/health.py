"""Live status of the core LanCache containers (not the prefill tools --
those are covered separately), via the same mounted docker.sock used
elsewhere in the backend."""

from dataclasses import dataclass
from datetime import datetime, timezone

import docker
from docker.errors import DockerException, NotFound

from app.settings import settings

CORE_CONTAINERS = ["lancache", "lancache-dns"]


@dataclass
class ContainerHealth:
    name: str
    status: str  # "running", "exited", "not_found", "unknown", ...
    uptime_seconds: float | None


def get_core_health() -> list[ContainerHealth]:
    try:
        client = docker.DockerClient(base_url=settings.docker_socket)
    except DockerException:
        return [ContainerHealth(name=n, status="unknown", uptime_seconds=None) for n in CORE_CONTAINERS]

    results: list[ContainerHealth] = []
    for name in CORE_CONTAINERS:
        try:
            container = client.containers.get(name)
            status = container.status  # e.g. "running", "exited"
            uptime_seconds = None
            if status == "running":
                started_at = container.attrs.get("State", {}).get("StartedAt")
                if started_at:
                    # Docker's StartedAt is RFC3339 with nanosecond precision,
                    # which Python's fromisoformat can't parse directly --
                    # truncate to microseconds.
                    cleaned = started_at.split(".")[0] + "Z" if "." in started_at else started_at
                    try:
                        started = datetime.fromisoformat(cleaned.replace("Z", "+00:00"))
                        uptime_seconds = (datetime.now(timezone.utc) - started).total_seconds()
                    except ValueError:
                        uptime_seconds = None
            results.append(ContainerHealth(name=name, status=status, uptime_seconds=uptime_seconds))
        except NotFound:
            results.append(ContainerHealth(name=name, status="not_found", uptime_seconds=None))

    return results
