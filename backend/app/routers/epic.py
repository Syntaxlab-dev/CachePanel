"""Epic Games has no public per-account ownership API (unlike Steam) and no
small fixed catalog (unlike Battle.Net) — so v1 ships with manual entry only.
Full catalog browsing (via an Epic OAuth device-code flow, the same approach
the open-source `legendary` project uses) is a natural v2 addition.
"""

from fastapi import APIRouter
from pydantic import BaseModel

from app.services import prefill_selection
from app.settings import settings

router = APIRouter(prefix="/api/epic", tags=["epic"])


class SelectionUpdate(BaseModel):
    app_ids: list[str]


@router.get("/selection")
def get_selection():
    return {"app_ids": prefill_selection.read_selection(settings.epic_prefill_config_dir)}


@router.post("/selection")
def update_selection(body: SelectionUpdate):
    prefill_selection.write_selection(settings.epic_prefill_config_dir, body.app_ids)
    return {"app_ids": body.app_ids}
