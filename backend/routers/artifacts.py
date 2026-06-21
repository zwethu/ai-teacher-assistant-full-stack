"""Artifact listing and deletion routes."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status

from services.artifact_service import (
    artifact_summary,
    delete_artifact,
    export_lesson_plan_draft_to_google_docs,
    get_artifact,
    list_artifacts,
)
from services.google_workspace.credentials import (
    GoogleOAuthInvalidError,
    GoogleOAuthRequiredError,
)
from utils.firebase_auth import CurrentUser, get_current_user

router = APIRouter(prefix="/batches/{batch_id}/artifacts", tags=["artifacts"])

GOOGLE_OAUTH_REQUIRED_DETAIL = {
    "code": "GOOGLE_OAUTH_REQUIRED",
    "message": "Connect Google Workspace before exporting to Google Docs.",
    "connect_url": "/auth/google-scopes",
}


@router.get("")
async def list_artifacts_endpoint(
    batch_id: str,
    type: str | None = Query(default=None),
    week: int | None = Query(default=None),
    current: bool | None = Query(default=None),
    status_filter: str | None = Query(default=None, alias="status"),
    current_user: CurrentUser = Depends(get_current_user),
) -> list[dict[str, Any]]:
    return list_artifacts(
        batch_id,
        current_user["uid"],
        {
            "type": type,
            "week": week,
            "current": current,
            "status": status_filter,
        },
    )


@router.get("/summary")
async def artifact_summary_endpoint(
    batch_id: str,
    current_user: CurrentUser = Depends(get_current_user),
) -> dict[str, Any]:
    summary = artifact_summary(batch_id, current_user["uid"])
    if summary is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Batch not found")
    return summary


@router.get("/{artifact_id}")
async def get_artifact_endpoint(
    batch_id: str,
    artifact_id: str,
    current_user: CurrentUser = Depends(get_current_user),
) -> dict[str, Any]:
    artifact = get_artifact(batch_id, artifact_id, current_user["uid"])
    if artifact is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Artifact not found")
    return artifact


@router.post("/{artifact_id}/export/google-docs")
async def export_lesson_plan_google_docs_endpoint(
    batch_id: str,
    artifact_id: str,
    current_user: CurrentUser = Depends(get_current_user),
) -> dict[str, Any]:
    try:
        return export_lesson_plan_draft_to_google_docs(
            batch_id=batch_id,
            artifact_id=artifact_id,
            lecturer_id=current_user["uid"],
        )
    except (GoogleOAuthRequiredError, GoogleOAuthInvalidError) as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=GOOGLE_OAUTH_REQUIRED_DETAIL,
        ) from exc
    except PermissionError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Artifact not found",
        ) from exc
    except RuntimeError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=str(exc),
        ) from exc


@router.delete("/{artifact_id}")
async def delete_artifact_endpoint(
    batch_id: str,
    artifact_id: str,
    delete_google: bool = Query(default=True),
    current_user: CurrentUser = Depends(get_current_user),
) -> dict[str, Any]:
    try:
        result = delete_artifact(
            batch_id=batch_id,
            artifact_id=artifact_id,
            lecturer_id=current_user["uid"],
            delete_google=delete_google,
        )
    except RuntimeError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=str(exc),
        ) from exc
    if result is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Artifact not found")
    return result
