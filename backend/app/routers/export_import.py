"""Export/import the current selection across all three prefill tools as a
single JSON bundle, so a user can back it up or move it to another
CachePanel instance without reselecting everything by hand.
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.services import prefill_selection
from app.settings import settings

router = APIRouter(prefix="/api", tags=["export"])

SCHEMA_VERSION = 1


class ImportBundle(BaseModel):
    schema_version: int
    steam_app_ids: list[int]
    battlenet_codes: list[str]
    epic_app_ids: list[str]


@router.get("/export", summary="Export full prefill selection", description="Bundles the Steam/Battle.net/Epic selections into one JSON document for backup or transfer to another CachePanel instance.")
def export_selection():
    return {
        "schema_version": SCHEMA_VERSION,
        "steam_app_ids": prefill_selection.read_selection(settings.steam_prefill_config_dir),
        "battlenet_codes": prefill_selection.read_selection(settings.battlenet_prefill_config_dir),
        "epic_app_ids": prefill_selection.read_selection(settings.epic_prefill_config_dir),
    }


@router.post("/import", summary="Import full prefill selection", description="Replaces the Steam/Battle.net/Epic selections from a previously exported bundle. All-or-nothing: rejected entirely if the schema version doesn't match.")
def import_selection(bundle: ImportBundle):
    if bundle.schema_version != SCHEMA_VERSION:
        raise HTTPException(
            status_code=400,
            detail=f"Unbekannte Export-Version {bundle.schema_version} (erwartet: {SCHEMA_VERSION})",
        )

    # Pydantic already validated the shape (right types for each list) --
    # only apply once all three are known-good, no partial writes on
    # malformed input.
    prefill_selection.write_selection(settings.steam_prefill_config_dir, bundle.steam_app_ids)
    prefill_selection.write_selection(settings.battlenet_prefill_config_dir, bundle.battlenet_codes)
    prefill_selection.write_selection(settings.epic_prefill_config_dir, bundle.epic_app_ids)

    return {
        "steam_app_ids": bundle.steam_app_ids,
        "battlenet_codes": bundle.battlenet_codes,
        "epic_app_ids": bundle.epic_app_ids,
    }
