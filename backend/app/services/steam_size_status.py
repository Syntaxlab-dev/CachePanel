"""Parses the output of `SteamPrefill select-apps status --no-ansi`, which
is the only one of the three prefill tools (Steam/Battle.net/Epic) that
exposes a per-app download-size breakdown for the current selection —
confirmed by checking `select-apps --help` on all three containers.
BattleNetPrefill and EpicPrefill have no equivalent subcommand.

This runs a real Steam login every time (the tool's own doing, not
something we can avoid), so it takes ~10-15s. Callers should treat it as
an on-demand action, not something to run on every page load.
"""

import re
from dataclasses import dataclass

import docker
from docker.errors import DockerException, NotFound

from app.settings import settings

# Row shape: "  <app name padded>  │ <size>  ", using the box-drawing
# vertical bar U+2502 as the column separator. The totals row has an empty
# name column. Separator/rule lines use ━ and ┿, never this exact pattern.
ROW_RE = re.compile(r"^\s*(.*?)\s*│\s*(.+?)\s*$")


@dataclass
class SizedApp:
    name: str
    size: str


@dataclass
class SteamSizeStatus:
    apps: list[SizedApp]
    total_size: str | None


class SteamSizeStatusError(RuntimeError):
    pass


def _parse(raw_output: str) -> SteamSizeStatus:
    apps: list[SizedApp] = []
    total_size: str | None = None
    seen_header = False

    for line in raw_output.splitlines():
        if "━" in line or "─" in line:  # rule lines (━ or ─)
            continue
        match = ROW_RE.match(line)
        if not match:
            continue
        name, size = match.group(1).strip(), match.group(2).strip()
        if not size:
            continue
        if name == "App" and size == "Download Size":
            seen_header = True
            continue
        if not seen_header:
            continue
        if not name:
            total_size = size
        else:
            apps.append(SizedApp(name=name, size=size))

    return SteamSizeStatus(apps=apps, total_size=total_size)


def get_size_status() -> SteamSizeStatus:
    container_name = settings.steam_prefill_container
    try:
        client = docker.DockerClient(base_url=settings.docker_socket)
        container = client.containers.get(container_name)
    except NotFound as exc:
        raise SteamSizeStatusError(f"Container '{container_name}' not found") from exc
    except DockerException as exc:
        raise SteamSizeStatusError(f"Could not reach Docker daemon: {exc}") from exc

    exit_code, output = container.exec_run(
        ["/app/SteamPrefill", "select-apps", "status", "--no-ansi"], demux=False
    )
    decoded = output.decode("utf-8", errors="replace") if output else ""
    if exit_code != 0:
        raise SteamSizeStatusError(f"SteamPrefill exited with code {exit_code}: {decoded[-500:]}")

    return _parse(decoded)
