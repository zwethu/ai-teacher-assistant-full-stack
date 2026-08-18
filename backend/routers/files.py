import logging

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile, status

from entity.File import BatchFile
from services.batch_service import get_batch
from services.file_service import (
    count_batch_files,
    delete_batch_file,
    enqueue_index_batch_file,
    get_batch_file,
    get_course_space_max_files,
    list_batch_files,
    sync_index_status,
    upload_batch_file,
)
from utils.firebase_auth import CurrentUser, get_current_user
from services.chat_attachment_service import AttachmentValidationError, validate_batch_document

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/batches/{batch_id}/files", tags=["files"])

ALLOWED_CONTENT_TYPES = frozenset(
    {
        "application/pdf",
        "text/plain",
        "text/markdown",
        "application/json",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "text/csv",
    }
)
MAX_FILE_SIZE_MB = 50


@router.post("", response_model=BatchFile, status_code=status.HTTP_201_CREATED)
async def upload_file_endpoint(
    batch_id: str,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    file_title: str = Form(""),
    current_user: CurrentUser = Depends(get_current_user),
) -> BatchFile:
    lecturer_id: str = current_user["uid"]

    batch = get_batch(batch_id, lecturer_id)
    if batch is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Batch not found")

    max_files = get_course_space_max_files()
    if count_batch_files(batch_id) >= max_files:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"This batch is at its {max_files}-file limit for course materials. Remove a file "
                "before adding another, or use chat attachments for one-off documents."
            ),
        )

    content_type = file.content_type or "application/octet-stream"
    file_bytes = await file.read()
    size_mb = len(file_bytes) / (1024 * 1024)
    if size_mb > MAX_FILE_SIZE_MB:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"File too large ({size_mb:.1f} MB). Maximum is {MAX_FILE_SIZE_MB} MB.",
        )

    try:
        safe_name, content_type = validate_batch_document(
            file.filename or "upload", content_type, file_bytes, MAX_FILE_SIZE_MB * 1024 * 1024,
        )
    except AttachmentValidationError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc

    record = upload_batch_file(
        file_bytes=file_bytes,
        file_name=safe_name,
        file_title=file_title or file.filename or "",
        content_type=content_type,
        batch_id=batch_id,
        lecturer_id=lecturer_id,
        course_name=batch.course_name,
        batch_name=batch.batch_name,
    )

    enqueue_index_batch_file(
        file_id=record.file_id,
        batch_id=batch_id,
        gcs_path=record.gcs_path,
        lecturer_id=lecturer_id,
        file_title=record.file_title,
        course_name=batch.course_name,
        batch_name=batch.batch_name,
        background_tasks=background_tasks,
    )

    return record


@router.get("", response_model=list[BatchFile])
async def list_files_endpoint(
    batch_id: str,
    current_user: CurrentUser = Depends(get_current_user),
) -> list[BatchFile]:
    return list_batch_files(batch_id, current_user["uid"])


@router.get("/{file_id}", response_model=BatchFile)
async def get_file_endpoint(
    batch_id: str,
    file_id: str,
    current_user: CurrentUser = Depends(get_current_user),
) -> BatchFile:
    record = get_batch_file(batch_id, file_id, current_user["uid"])
    if record is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="File not found or access denied",
        )
    return record


@router.post("/{file_id}/sync-index-status", response_model=BatchFile)
async def sync_index_status_endpoint(
    batch_id: str,
    file_id: str,
    current_user: CurrentUser = Depends(get_current_user),
) -> BatchFile:
    record = sync_index_status(batch_id, file_id, current_user["uid"])
    if record is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="File not found or access denied",
        )
    return record


@router.delete("/{file_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_file_endpoint(
    batch_id: str,
    file_id: str,
    current_user: CurrentUser = Depends(get_current_user),
) -> None:
    ok = delete_batch_file(batch_id, file_id, current_user["uid"])
    if not ok:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="File not found or access denied",
        )
