from fastapi import APIRouter
from pydantic import BaseModel

from app.services import schedule_store, scheduler_service

router = APIRouter(prefix="/api/schedule", tags=["schedule"])


class ScheduleWindow(BaseModel):
    # Optional on input: a brand-new window added in the editor has no id
    # yet, schedule_store.py assigns one on save. Present on every window
    # returned by GET, used by the frontend as its React list key and to
    # tell an edited window apart from a newly-added one.
    id: int | None = None
    hour: int
    minute: int
    # 0=Monday..6=Sunday (matches APScheduler's own CronTrigger day_of_week
    # convention, already used elsewhere in this project). Empty/omitted
    # means every day, same as the pre-Welle-5 behavior.
    days: list[int] = []


class ServiceScheduleUpdate(BaseModel):
    enabled: bool | None = None
    # Always a FULL replacement of this service's window list when present
    # -- see schedule_store.update_schedule()'s own docstring.
    windows: list[ScheduleWindow] | None = None


class ScheduleUpdate(BaseModel):
    steam: ServiceScheduleUpdate | None = None
    battlenet: ServiceScheduleUpdate | None = None
    epic: ServiceScheduleUpdate | None = None


@router.get("", summary="Current per-service prefill schedule", description="Each service has an `enabled` flag and a list of time windows (hour/minute/days) -- see schedule_store.py for the migration story from the older single-window shape.")
def get_schedule():
    return schedule_store.get_schedule()


@router.post("", summary="Update per-service prefill schedule", description="Partial update -- only services present in the body are changed; within a service, `windows` (if present) always replaces the whole list. Triggers an immediate scheduler reload.")
def update_schedule(body: ScheduleUpdate):
    partial = {}
    for service, entry in (("steam", body.steam), ("battlenet", body.battlenet), ("epic", body.epic)):
        if entry is None:
            continue
        service_partial: dict = {}
        if entry.enabled is not None:
            service_partial["enabled"] = entry.enabled
        if entry.windows is not None:
            service_partial["windows"] = [w.model_dump() for w in entry.windows]
        if service_partial:
            partial[service] = service_partial

    updated = schedule_store.update_schedule(partial)
    scheduler_service.reload_jobs()
    return updated
