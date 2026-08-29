"""Live status of the core LanCache containers (not the prefill tools --
those are covered separately), via the same mounted docker.sock used
elsewhere in the backend, plus a higher-level "why isn't this working"
diagnostics pass (DNS resolution + cache heartbeat) built on top of it."""

from dataclasses import dataclass
from datetime import datetime, timezone

import dns.exception
import dns.resolver
import docker
import requests
from docker.errors import DockerException, NotFound

from app.settings import settings

CORE_CONTAINERS = ["lancache", "lancache-dns"]

# lancache-dns only answers for domains listed in the uklans/cache-domains
# lists it ships (/opt/cache-domains/<service>.txt inside the container),
# NOT arbitrary CDN hostnames -- confirmed live: querying the bare
# "steamcontent.com" apex or a real edge hostname like
# "alibaba.cdn.steampipe.steamcontent.com" both got forwarded upstream
# (NODATA / real Akamai IPs), while /opt/cache-domains/steam.txt turned out
# to contain exactly "lancache.steamcontent.com". That FQDN is the
# standard, well-known "is a LAN cache present" probe hostname Steam (and
# every other uklans/cache-domains-covered launcher) queries as part of its
# own cache-detection protocol -- present in effectively every LanCache
# deployment, not specific to this one, which is why it's the right choice
# for a generic diagnostic check.
DIAGNOSTIC_TEST_DOMAIN = "lancache.steamcontent.com"


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


@dataclass
class DiagnosticCheck:
    id: str
    status: str  # "ok" | "warn" | "fail" | "unknown"
    message: str


def run_diagnostics() -> list[DiagnosticCheck]:
    """Answers "why isn't caching working" with concrete, human-readable
    checks instead of raw container status. Order matters: each check
    assumes the ones before it are OK, so the first non-ok result in the
    list is the most likely root cause.
    """
    checks: list[DiagnosticCheck] = []
    container_status = {c.name: c.status for c in get_core_health()}

    # 1. Are the core containers even running?
    for name in CORE_CONTAINERS:
        status = container_status.get(name, "unknown")
        if status == "running":
            checks.append(DiagnosticCheck(id=f"container_{name}", status="ok", message=f"{name} läuft."))
        else:
            checks.append(
                DiagnosticCheck(
                    id=f"container_{name}",
                    status="fail",
                    message=f"{name} läuft nicht (Status: {status}). Ohne diesen Container funktioniert nichts -- "
                    "zuerst neu starten.",
                )
            )

    if not settings.lancache_ip:
        checks.append(
            DiagnosticCheck(
                id="lancache_ip_configured",
                status="unknown",
                message="LANCACHE_IP ist nicht konfiguriert -- DNS- und Erreichbarkeits-Check können nicht "
                "durchgeführt werden. In der .env von CachePanel setzen (die LAN-IP dieses Servers).",
            )
        )
        return checks

    # 2. Does lancache-dns actually resolve a known cached domain to our own IP?
    # (a client using the wrong DNS server is the #1 real-world cause of
    # "my cache isn't being used" -- this check catches exactly that.)
    if container_status.get("lancache-dns") == "running":
        try:
            resolver = dns.resolver.Resolver(configure=False)
            resolver.nameservers = [settings.lancache_ip]
            resolver.timeout = 3
            resolver.lifetime = 3
            answer = resolver.resolve(DIAGNOSTIC_TEST_DOMAIN, "A")
            resolved_ips = {str(r) for r in answer}
            if settings.lancache_ip in resolved_ips:
                checks.append(
                    DiagnosticCheck(
                        id="dns_resolution",
                        status="ok",
                        message=f"DNS beantwortet {DIAGNOSTIC_TEST_DOMAIN} korrekt mit {settings.lancache_ip}.",
                    )
                )
            else:
                checks.append(
                    DiagnosticCheck(
                        id="dns_resolution",
                        status="warn",
                        message=f"DNS antwortet, aber mit {', '.join(resolved_ips) or 'keiner IP'} statt "
                        f"{settings.lancache_ip} -- Clients werden so nicht auf den Cache umgeleitet.",
                    )
                )
        except dns.exception.Timeout:
            checks.append(
                DiagnosticCheck(
                    id="dns_resolution",
                    status="fail",
                    message=f"lancache-dns antwortet nicht auf Anfragen an {settings.lancache_ip}:53 (Timeout). "
                    "Prüfen, ob Port 53 erreichbar ist und keine Firewall dazwischenfunkt.",
                )
            )
        except dns.exception.DNSException as exc:
            checks.append(
                DiagnosticCheck(
                    id="dns_resolution",
                    status="fail",
                    message=f"DNS-Abfrage fehlgeschlagen: {exc}",
                )
            )
    else:
        checks.append(
            DiagnosticCheck(
                id="dns_resolution",
                status="fail",
                message="lancache-dns läuft nicht, DNS-Check übersprungen.",
            )
        )

    # 3. Is the cache itself reachable over HTTP (the part DNS points clients at)?
    if container_status.get("lancache") == "running":
        try:
            resp = requests.get(f"http://{settings.lancache_ip}/lancache-heartbeat", timeout=3)
            if resp.status_code == 204:
                checks.append(
                    DiagnosticCheck(
                        id="cache_reachable",
                        status="ok",
                        message=f"Cache ist unter {settings.lancache_ip}:80 erreichbar (Heartbeat OK).",
                    )
                )
            else:
                checks.append(
                    DiagnosticCheck(
                        id="cache_reachable",
                        status="warn",
                        message=f"Heartbeat antwortet mit unerwartetem Status {resp.status_code} statt 204.",
                    )
                )
        except requests.RequestException as exc:
            checks.append(
                DiagnosticCheck(
                    id="cache_reachable",
                    status="fail",
                    message=f"Cache ist unter {settings.lancache_ip}:80 nicht erreichbar ({exc}). "
                    "Netzwerk-/Firewall-Problem zwischen CachePanel und lancache prüfen.",
                )
            )
    else:
        checks.append(
            DiagnosticCheck(
                id="cache_reachable",
                status="fail",
                message="lancache läuft nicht, Erreichbarkeits-Check übersprungen.",
            )
        )

    return checks
