import os
from pathlib import Path


class Settings:
    steam_api_key: str = os.environ.get("STEAM_API_KEY", "")
    steam_id64: str = os.environ.get("STEAM_ID64", "")

    steam_prefill_config_dir: Path = Path(os.environ.get("STEAM_PREFILL_CONFIG_DIR", "/opt/stacks/steam-prefill/config"))
    battlenet_prefill_config_dir: Path = Path(os.environ.get("BATTLENET_PREFILL_CONFIG_DIR", "/opt/stacks/battlenet-prefill/config"))
    epic_prefill_config_dir: Path = Path(os.environ.get("EPIC_PREFILL_CONFIG_DIR", "/opt/stacks/epic-prefill/config"))

    lancache_log_dir: Path = Path(os.environ.get("LANCACHE_LOG_DIR", "/mnt/lancache/logs"))

    docker_socket: str = os.environ.get("DOCKER_SOCKET", "unix://var/run/docker.sock")

    steam_prefill_container: str = os.environ.get("STEAM_PREFILL_CONTAINER", "steam-prefill")
    battlenet_prefill_container: str = os.environ.get("BATTLENET_PREFILL_CONTAINER", "battlenet-prefill")
    epic_prefill_container: str = os.environ.get("EPIC_PREFILL_CONTAINER", "epic-prefill")


settings = Settings()
