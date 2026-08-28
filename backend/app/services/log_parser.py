"""Parses LanCache (lancachenet/monolithic) access + stream logs.

Real log line formats (verified against a live lancache instance):

access.log (HTTP caching, per-chunk):
    [steam] 172.20.0.1 / - - - [27/Aug/2026:23:11:01 +0100] "GET /depot/1169043/chunk/da55... HTTP/1.1" \
        200 184448 "-" "Valve/Steam HTTP Client 1.0" "MISS" "google2.cdn.steampipe.steamcontent.com" "-"

stream-access.log (TLS passthrough / SNI proxy, no per-file granularity):
    172.20.0.1 [27/Aug/2026:08:23:07 +0100] TCP 200 us.cdn.blizzard.com 0 0 9.997
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

ACCESS_LOG_RE = re.compile(
    r"^\[(?P<service>[^\]]+)\]\s+(?P<client_ip>\S+)\s+/\s+-\s+-\s+-\s+"
    r"\[(?P<date>[^\]]+)\]\s+"
    r'"(?P<method>\S+)\s+(?P<path>\S+)\s+HTTP/[\d.]+"\s+'
    r"(?P<status>\d+)\s+(?P<bytes>\d+)\s+"
    r'"(?P<referer>[^"]*)"\s+"(?P<user_agent>[^"]*)"\s+"(?P<cache_status>[^"]*)"\s+'
    r'"(?P<cdn_host>[^"]*)"\s+"(?P<x_forwarded>[^"]*)"$'
)

STREAM_LOG_RE = re.compile(
    r"^(?P<client_ip>\S+)\s+\[(?P<date>[^\]]+)\]\s+(?P<protocol>\S+)\s+(?P<status>\d+)\s+"
    r"(?P<hostname>\S+)\s+(?P<bytes_sent>\d+)\s+(?P<bytes_received>\d+)\s+(?P<session_time>[\d.]+)$"
)

DATE_FORMAT = "%d/%b/%Y:%H:%M:%S %z"


@dataclass
class AccessEntry:
    timestamp: datetime
    service: str
    client_ip: str
    bytes: int
    cache_status: str  # HIT or MISS


@dataclass
class ServiceStats:
    service: str
    hit_bytes: int = 0
    miss_bytes: int = 0
    hit_count: int = 0
    miss_count: int = 0
    last_seen: datetime | None = None

    @property
    def total_bytes(self) -> int:
        return self.hit_bytes + self.miss_bytes

    @property
    def hit_ratio(self) -> float:
        total = self.hit_count + self.miss_count
        return round(self.hit_count / total, 4) if total else 0.0


def _parse_date(raw: str) -> datetime | None:
    try:
        return datetime.strptime(raw, DATE_FORMAT)
    except ValueError:
        return None


def iter_access_entries(log_path: Path, max_lines: int = 200_000) -> list[AccessEntry]:
    """Reads an access.log-style file and yields structured entries.

    Skips heartbeat/health-check noise and unparsable lines. Reads from the
    end of the file (most recent activity first) up to max_lines, to keep
    memory bounded on multi-GB rotated logs.
    """
    if not log_path.exists():
        return []

    entries: list[AccessEntry] = []
    lines = _tail_lines(log_path, max_lines)
    for line in lines:
        if "lancache-heartbeat" in line:
            continue
        match = ACCESS_LOG_RE.match(line)
        if not match:
            continue
        ts = _parse_date(match.group("date"))
        if ts is None:
            continue
        entries.append(
            AccessEntry(
                timestamp=ts,
                service=match.group("service"),
                client_ip=match.group("client_ip"),
                bytes=int(match.group("bytes")),
                cache_status=match.group("cache_status").upper(),
            )
        )
    return entries


def _tail_lines(path: Path, max_lines: int) -> list[str]:
    """Reads up to max_lines from the end of a text file without loading it
    entirely into memory for very large files."""
    chunk_size = 1024 * 1024
    lines: list[str] = []
    with path.open("rb") as f:
        f.seek(0, 2)
        file_size = f.tell()
        block = -1
        remaining = b""
        while len(lines) <= max_lines and file_size + block * chunk_size > 0:
            seek_pos = max(0, file_size + block * chunk_size)
            f.seek(seek_pos)
            data = f.read(min(chunk_size, file_size - seek_pos)) + remaining
            parts = data.split(b"\n")
            remaining = parts[0]
            lines = [p.decode("utf-8", errors="replace") for p in parts[1:] if p] + lines
            block -= 1
            if seek_pos == 0:
                if remaining:
                    lines = [remaining.decode("utf-8", errors="replace")] + lines
                break
    return lines[-max_lines:]


def aggregate_service_stats(entries: list[AccessEntry]) -> dict[str, ServiceStats]:
    stats: dict[str, ServiceStats] = {}
    for entry in entries:
        s = stats.setdefault(entry.service, ServiceStats(service=entry.service))
        if entry.cache_status == "HIT":
            s.hit_bytes += entry.bytes
            s.hit_count += 1
        else:
            s.miss_bytes += entry.bytes
            s.miss_count += 1
        if s.last_seen is None or entry.timestamp > s.last_seen:
            s.last_seen = entry.timestamp
    return stats


def recent_activity(entries: list[AccessEntry], bucket_minutes: int = 10, limit: int = 30) -> list[dict]:
    """Groups raw per-chunk log lines into coarse activity buckets
    (service + rounded time window), so a Steam depot download that
    generates thousands of chunk requests shows up as a handful of
    rows instead of flooding the UI.
    """
    buckets: dict[tuple[str, str], dict] = {}
    for entry in entries:
        bucket_key_dt = entry.timestamp.replace(
            minute=(entry.timestamp.minute // bucket_minutes) * bucket_minutes, second=0, microsecond=0
        )
        key = (entry.service, bucket_key_dt.isoformat())
        bucket = buckets.setdefault(
            key,
            {
                "service": entry.service,
                "bucket_start": bucket_key_dt.isoformat(),
                "hit_bytes": 0,
                "miss_bytes": 0,
                "requests": 0,
            },
        )
        bucket["requests"] += 1
        if entry.cache_status == "HIT":
            bucket["hit_bytes"] += entry.bytes
        else:
            bucket["miss_bytes"] += entry.bytes

    rows = sorted(buckets.values(), key=lambda b: b["bucket_start"], reverse=True)
    return rows[:limit]
