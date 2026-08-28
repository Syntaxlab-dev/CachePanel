from fastapi import APIRouter
from pydantic import BaseModel

from app.services import schedule_store, scheduler_service

router = APIRouter(prefix="/api/schedule", tags=["schedule"])


class ServiceScheduleUpdate(BaseModel):
    enabled: bool | None = None
    hour: int | None = None
    minute: int | None = None


class ScheduleUpdate(BaseModel):
    steam: ServiceScheduleUpdate | None = None
    battlenet: ServiceScheduleUpdate | None = None
    epic: ServiceScheduleUpdate | None = None


@router.get("")
def get_schedule():
    return schedule_store.get_schedule()


@router.post("")
def update_schedule(body: ScheduleUpdate):
    partial = {}
    for service, entry in (("steam", body.steam), ("battlenet", body.battlenet), ("epic", body.epic)):
        if entry is not None:
            partial[service] = {k: v for k, v in entry.model_dump().items() if v is not None}

    updated = schedule_store.update_schedule(partial)
    scheduler_service.reload_jobs()
    return updated
