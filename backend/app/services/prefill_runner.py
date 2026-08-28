"""Triggers an on-demand prefill run inside an already-running prefill
container, via the Docker Engine API (talking to the mounted docker.sock).
Equivalent to `docker exec <container> <Binary> prefill [flags]`, but
callable from the web UI instead of a terminal.
"""

from dataclasses import dataclass

import docker
from docker.errors import DockerException, NotFound

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

    exit_code, output = container.exec_run(command, demux=False)
    decoded = output.decode("utf-8", errors="replace") if output else ""
    return PrefillRunResult(service=service, exit_code=exit_code, output=decoded[-4000:])
