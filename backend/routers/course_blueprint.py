from fastapi import APIRouter, Depends, HTTPException, status

from entity.CourseBlueprint import (
    CourseBlueprintFromMessageRequest,
    CourseBlueprintUpdateRequest,
)
from services.course_blueprint_service import (
    BlueprintConflictError,
    BlueprintEligibilityError,
    BlueprintNotFoundError,
    archive_current_blueprint,
    delete_blueprint_version,
    get_current_blueprint,
    list_blueprint_history,
    restore_archived_blueprint,
    revert_to_blueprint_version,
    save_blueprint_from_message,
    update_current_blueprint,
)
from utils.firebase_auth import CurrentUser, get_current_user

router = APIRouter(prefix="/batches/{batch_id}/course-blueprint", tags=["course-blueprint"])


def _raise_service_error(exc: Exception) -> None:
    if isinstance(exc, BlueprintNotFoundError):
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    if isinstance(exc, BlueprintConflictError):
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    if isinstance(exc, BlueprintEligibilityError):
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    raise exc


@router.get("/current", response_model=dict)
async def current(batch_id: str, user: CurrentUser = Depends(get_current_user)) -> dict:
    try:
        return {"blueprint": get_current_blueprint(batch_id, user["uid"])}
    except Exception as exc:
        _raise_service_error(exc)
        raise


@router.get("/history", response_model=list[dict])
async def history(batch_id: str, user: CurrentUser = Depends(get_current_user)) -> list[dict]:
    try:
        return list_blueprint_history(batch_id, user["uid"])
    except Exception as exc:
        _raise_service_error(exc)
        raise


@router.post("/from-message", response_model=dict, status_code=status.HTTP_201_CREATED)
async def from_message(
    batch_id: str,
    body: CourseBlueprintFromMessageRequest,
    user: CurrentUser = Depends(get_current_user),
) -> dict:
    try:
        return save_blueprint_from_message(batch_id, user["uid"], body)
    except Exception as exc:
        _raise_service_error(exc)
        raise


@router.put("/current", response_model=dict)
async def update_current(
    batch_id: str,
    body: CourseBlueprintUpdateRequest,
    user: CurrentUser = Depends(get_current_user),
) -> dict:
    try:
        return update_current_blueprint(batch_id, user["uid"], body)
    except Exception as exc:
        _raise_service_error(exc)
        raise


@router.post("/current/archive", response_model=dict)
async def archive_current(
    batch_id: str, user: CurrentUser = Depends(get_current_user)
) -> dict:
    try:
        return archive_current_blueprint(batch_id, user["uid"])
    except Exception as exc:
        _raise_service_error(exc)
        raise


@router.post("/versions/{blueprint_id}/restore", response_model=dict)
async def restore_version(
    batch_id: str, blueprint_id: str, user: CurrentUser = Depends(get_current_user)
) -> dict:
    """Undo an archive in place -- no new version, no duplicate in history."""
    try:
        return restore_archived_blueprint(batch_id, user["uid"], blueprint_id)
    except Exception as exc:
        _raise_service_error(exc)
        raise


@router.post("/versions/{blueprint_id}/revert", response_model=dict)
async def revert_version(
    batch_id: str, blueprint_id: str, user: CurrentUser = Depends(get_current_user)
) -> dict:
    try:
        return revert_to_blueprint_version(batch_id, user["uid"], blueprint_id)
    except Exception as exc:
        _raise_service_error(exc)
        raise


@router.delete("/versions/{blueprint_id}", response_model=dict)
async def delete_version(
    batch_id: str, blueprint_id: str, user: CurrentUser = Depends(get_current_user)
) -> dict:
    try:
        return delete_blueprint_version(batch_id, user["uid"], blueprint_id)
    except Exception as exc:
        _raise_service_error(exc)
        raise
