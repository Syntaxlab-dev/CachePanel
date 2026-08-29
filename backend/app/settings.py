import os
from pathlib import Path


class Settings:
    steam_api_key: str = os.environ.get("STEAM_API_KEY", "")
    steam_id64: str = os.environ.get("STEAM_ID64", "")

    steam_prefill_config_dir: Path = Path(os.environ.get("STEAM_PREFILL_CONFIG_DIR", "/opt/stacks/steam-prefill/config"))
    battlenet_prefill_config_dir: Path = Path(os.environ.get("BATTLENET_PREFILL_CONFIG_DIR", "/opt/stacks/battlenet-prefill/config"))
    epic_prefill_config_dir: Path = Path(os.environ.get("EPIC_PREFILL_CONFIG_DIR", "/opt/stacks/epic-prefill/config"))

    lancache_log_dir: Path = Path(os.environ.get("LANCACHE_LOG_DIR", "/mnt/lancache/logs"))

    # LAN IP of the machine serving both lancache-dns (port 53) and lancache
    # (port 80) -- in this project's own docker-compose layout that's always
    # the same host CachePanel itself runs on, but it's not auto-detectable
    # in general, so it's opt-in config rather than a guessed default. Used
    # by the DNS/heartbeat diagnostics in services/health.py. Blank = those
    # checks report "not configured" instead of guessing wrong.
    lancache_ip: str = os.environ.get("LANCACHE_IP", "")

    docker_socket: str = os.environ.get("DOCKER_SOCKET", "unix://var/run/docker.sock")

    # Optional: use PostgreSQL instead of JSON files under /data for
    # settings/run history/schedule/panel login (see services/db.py).
    # Blank (default) = unchanged JSON-file behavior, zero config needed.
    database_url: str = os.environ.get("DATABASE_URL", "")

    steam_prefill_container: str = os.environ.get("STEAM_PREFILL_CONTAINER", "steam-prefill")
    battlenet_prefill_container: str = os.environ.get("BATTLENET_PREFILL_CONTAINER", "battlenet-prefill")
    epic_prefill_container: str = os.environ.get("EPIC_PREFILL_CONTAINER", "epic-prefill")


settings = Settings()
