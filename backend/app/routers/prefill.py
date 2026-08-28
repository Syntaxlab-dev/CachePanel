from fastapi import APIRouter, HTTPException

from app.services.prefill_runner import PrefillRunnerError, trigger_prefill

router = APIRouter(prefix="/api/prefill", tags=["prefill"])


@router.post("/{service}/run")
def run_prefill(service: str):
    try:
        result = trigger_prefill(service)
    except PrefillRunnerError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return {
        "service": result.service,
        "exit_code": result.exit_code,
        "output": result.output,
    }
