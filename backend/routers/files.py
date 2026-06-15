import logging

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status

from entity.File import BatchFile
from services.batch_service import get_batch
from services.file_service import (
    delete_batch_file,
    enqueue_index_batch_file,
    list_batch_files,
    upload_batch_file,
)
from utils.firebase_auth import CurrentUser, get_current_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/batches/{batch_id}/files", tags=["files"])

ALLOWED_CONTENT_TYPES = frozenset(
    {
        "application/pdf",
        "text/plain",
        "text/markdown",
        "application/json",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/msword",
    }
)
MAX_FILE_SIZE_MB = 50


@router.post("", response_model=BatchFile, status_code=status.HTTP_201_CREATED)
async def upload_file_endpoint(
    batch_id: str,
    file: UploadFile = File(...),
    file_title: str = Form(""),
    current_user: CurrentUser = Depends(get_current_user),
) -> BatchFile:
    lecturer_id: str = current_user["uid"]

    batch = get_batch(batch_id, lecturer_id)
    if batch is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Batch not found")

    content_type = file.content_type or "application/octet-stream"
    if content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Unsupported file type: {content_type}. Allowed: PDF, TXT, MD, DOCX, JSON.",
        )

    file_bytes = await file.read()
    size_mb = len(file_bytes) / (1024 * 1024)
    if size_mb > MAX_FILE_SIZE_MB:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"File too large ({size_mb:.1f} MB). Maximum is {MAX_FILE_SIZE_MB} MB.",
        )

    record = upload_batch_file(
        file_bytes=file_bytes,
        file_name=file.filename or "upload",
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
    )

    return record


@router.get("", response_model=list[BatchFile])
async def list_files_endpoint(
    batch_id: str,
    current_user: CurrentUser = Depends(get_current_user),
) -> list[BatchFile]:
    return list_batch_files(batch_id, current_user["uid"])


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
