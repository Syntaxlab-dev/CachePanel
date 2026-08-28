from fastapi import APIRouter
from pydantic import BaseModel

from app.services import prefill_selection
from app.services.battlenet_catalog import BATTLENET_CATALOG
from app.settings import settings

router = APIRouter(prefix="/api/battlenet", tags=["battlenet"])


class SelectionUpdate(BaseModel):
    codes: list[str]


@router.get("/catalog")
def get_catalog():
    selected = set(prefill_selection.read_selection(settings.battlenet_prefill_config_dir))
    return {
        "products": [
            {
                "code": p.code,
                "name": p.display_name,
                "publisher": p.publisher,
                "selected": p.code in selected,
            }
            for p in BATTLENET_CATALOG
        ]
    }


@router.get("/selection")
def get_selection():
    return {"codes": prefill_selection.read_selection(settings.battlenet_prefill_config_dir)}


@router.post("/selection")
def update_selection(body: SelectionUpdate):
    prefill_selection.write_selection(settings.battlenet_prefill_config_dir, body.codes)
    return {"codes": body.codes}
