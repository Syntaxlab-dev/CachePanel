"""Reads/writes the `selectedAppsToPrefill.json` files used by the
tpill90 *-lancache-prefill family of tools (SteamPrefill, BattleNetPrefill,
EpicPrefill). All three tools use the same on-disk convention: a flat JSON
array in their respective `Config` directory. Steam uses integers (App IDs),
Battle.Net and Epic use strings (product codes / app slugs).

We write directly to these files instead of driving each tool's interactive
`select-apps` terminal UI, which is exactly what CachePanel exists to
replace.
"""

import json
from pathlib import Path

SELECTION_FILENAME = "selectedAppsToPrefill.json"


def read_selection(config_dir: Path) -> list:
    path = config_dir / SELECTION_FILENAME
    if not path.exists():
        return []
    try:
        with path.open("r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, list) else []
    except (json.JSONDecodeError, OSError):
        return []


def write_selection(config_dir: Path, values: list) -> None:
    config_dir.mkdir(parents=True, exist_ok=True)
    path = config_dir / SELECTION_FILENAME
    tmp_path = path.with_suffix(".json.tmp")
    with tmp_path.open("w", encoding="utf-8") as f:
        json.dump(values, f)
    tmp_path.replace(path)
