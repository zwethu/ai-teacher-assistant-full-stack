"""Artifact listing and deletion routes."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status

from services.artifact_service import (
    artifact_summary,
    confirm_artifact,
    delete_artifact,
    export_lab_draft_to_google_docs,
    export_lesson_plan_draft_to_google_docs,
    export_quiz_draft_to_google_forms,
    get_artifact,
    list_artifacts,
)
from services.artifact_sync_service import sync_artifact_from_google_doc_if_stale
from services.google_workspace.credentials import (
    GoogleOAuthInvalidError,
    GoogleOAuthRequiredError,
)
from utils.firebase_auth import CurrentUser, get_current_user

router = APIRouter(prefix="/batches/{batch_id}/artifacts", tags=["artifacts"])

GOOGLE_OAUTH_REQUIRED_DETAIL = {
    "code": "GOOGLE_OAUTH_REQUIRED",
    "message": "Connect Google Workspace before exporting.",
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
async def export_google_docs_endpoint(
    batch_id: str,
    artifact_id: str,
    current_user: CurrentUser = Depends(get_current_user),
) -> dict[str, Any]:
    try:
        artifact = get_artifact(batch_id, artifact_id, current_user["uid"])
        if artifact is None:
            raise PermissionError("Artifact not found")
        artifact_type = str((artifact or {}).get("artifact_type") or (artifact or {}).get("type") or "")
        if artifact_type == "lesson_plan":
            return export_lesson_plan_draft_to_google_docs(
                batch_id=batch_id,
                artifact_id=artifact_id,
                lecturer_id=current_user["uid"],
            )
        if artifact_type == "lab":
            return export_lab_draft_to_google_docs(
                batch_id=batch_id,
                artifact_id=artifact_id,
                lecturer_id=current_user["uid"],
            )
        raise RuntimeError("Artifact cannot be exported to Google Docs")
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


@router.post("/{artifact_id}/export/google-forms")
async def export_google_forms_endpoint(
    batch_id: str,
    artifact_id: str,
    current_user: CurrentUser = Depends(get_current_user),
) -> dict[str, Any]:
    try:
        artifact = get_artifact(batch_id, artifact_id, current_user["uid"])
        if artifact is None:
            raise PermissionError("Artifact not found")
        artifact_type = str((artifact or {}).get("artifact_type") or (artifact or {}).get("type") or "")
        if artifact_type != "quiz":
            raise RuntimeError("Artifact cannot be exported to Google Forms")
        return export_quiz_draft_to_google_forms(
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


@router.post("/{artifact_id}/sync/google-docs")
async def sync_google_docs_endpoint(
    batch_id: str,
    artifact_id: str,
    current_user: CurrentUser = Depends(get_current_user),
) -> dict[str, Any]:
    result = sync_artifact_from_google_doc_if_stale(
        batch_id=batch_id,
        artifact_id=artifact_id,
        lecturer_id=current_user["uid"],
    )
    if result.get("status") in {"not_found", "missing"}:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Artifact not found")
    artifact = get_artifact(batch_id, artifact_id, current_user["uid"])
    return {"sync": result, "artifact": artifact}


@router.post("/{artifact_id}/confirm")
async def confirm_artifact_endpoint(
    batch_id: str,
    artifact_id: str,
    current_user: CurrentUser = Depends(get_current_user),
) -> dict[str, Any]:
    try:
        artifact = confirm_artifact(
            batch_id=batch_id,
            artifact_id=artifact_id,
            lecturer_id=current_user["uid"],
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    if artifact is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Artifact not found")
    return artifact


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
