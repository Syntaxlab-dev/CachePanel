"""Triggers an on-demand prefill run inside an already-running prefill
container, via the Docker Engine API (talking to the mounted docker.sock).
Equivalent to `docker exec <container> <Binary> prefill [flags]`, but
callable from the web UI instead of a terminal.
"""

import time
from collections.abc import Iterator
from dataclasses import dataclass

import docker
from docker.errors import DockerException, NotFound

from app.services import run_history_store
from app.settings import settings

PREFILL_COMMANDS: dict[str, tuple[str, list[str]]] = {
    "steam": (settings.steam_prefill_container, ["/app/SteamPrefill", "prefill"]),
    "battlenet": (settings.battlenet_prefill_container, ["/BattleNetPrefill", "prefill", "--blizzard"]),
    "epic": (settings.epic_prefill_container, ["/EpicPrefill", "prefill"]),
}


@dataclass
class PrefillRunResult:
    service: str
    exit_code: int
    output: str


class PrefillRunnerError(RuntimeError):
    pass


def trigger_prefill(service: str) -> PrefillRunResult:
    client, container, command = _get_container(service)

    started_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    t0 = time.monotonic()

    exit_code, output = container.exec_run(command, demux=False)
    decoded = output.decode("utf-8", errors="replace") if output else ""

    run_history_store.add_entry(service, started_at, exit_code, time.monotonic() - t0)

    return PrefillRunResult(service=service, exit_code=exit_code, output=decoded[-4000:])


def _get_container(service: str):
    if service not in PREFILL_COMMANDS:
        raise PrefillRunnerError(f"Unknown service '{service}'")
    container_name, command = PREFILL_COMMANDS[service]
    try:
        client = docker.DockerClient(base_url=settings.docker_socket)
        container = client.containers.get(container_name)
    except NotFound as exc:
        raise PrefillRunnerError(f"Container '{container_name}' not found") from exc
    except DockerException as exc:
        raise PrefillRunnerError(f"Could not reach Docker daemon: {exc}") from exc
    return client, container, command


# Public alias: the router calls this eagerly (outside the generator) to
# validate the service/container *before* opening the SSE stream -- see the
# docstring on stream_prefill for why that ordering matters.
resolve_stream_target = _get_container


def stream_prefill(client, container, command, service: str) -> Iterator[str]:
    """Yields SSE-formatted lines as prefill output arrives in real time,
    instead of blocking until the whole run finishes. Uses the low-level
    exec_create + exec_start(stream=True) API (verified live against the
    real steam-prefill container: chunks arrive incrementally over the
    exec's lifetime rather than landing as one blob at the end) instead of
    the high-level exec_run() used by trigger_prefill() above. Persists a
    run_history entry once the stream ends, same as trigger_prefill.

    Takes an already-resolved client/container/command (see
    resolve_stream_target below) rather than a bare service name, so that
    an unknown-service or container-not-found error can be raised and
    turned into a proper HTTP error *before* the streaming response has
    started -- once StreamingResponse begins, the 200 status and headers
    are already sent and a mid-stream exception can't become an HTTP 400
    anymore.
    """
    started_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    t0 = time.monotonic()

    yield f"event: started\ndata: {service}\n\n"

    exec_id = client.api.exec_create(container.id, command, stdout=True, stderr=True)["Id"]
    for chunk in client.api.exec_start(exec_id, stream=True, demux=False):
        text = chunk.decode("utf-8", errors="replace")
        for line in text.splitlines():
            # SSE data lines can't contain raw newlines; splitting per
            # source line keeps the client's log panel readable too.
            safe_line = line.replace("\r", "")
            yield f"data: {safe_line}\n\n"

    inspect = client.api.exec_inspect(exec_id)
    exit_code = inspect.get("ExitCode", -1)
    duration = time.monotonic() - t0

    run_history_store.add_entry(service, started_at, exit_code, duration)

    yield f"event: done\ndata: {exit_code}\n\n"
