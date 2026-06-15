import logging

from fastapi import APIRouter, Depends, HTTPException, status

from entity.Batch import BatchCreate, BatchModel
from services.batch_service import (
    add_student_to_batch,
    create_batch,
    delete_batch,
    get_batch,
    list_batches,
    list_students,
    remove_student_from_batch,
)
from utils.firebase_auth import CurrentUser, get_current_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/batches", tags=["batches"])


@router.post("", response_model=dict, status_code=status.HTTP_201_CREATED)
async def create_batch_endpoint(
    payload: BatchCreate,
    current_user: CurrentUser = Depends(get_current_user),
) -> dict:
    lecturer_id: str = current_user["uid"]
    lecturer_email: str = current_user.get("email") or ""
    batch_id = create_batch(payload, lecturer_id, lecturer_email)
    return {"batch_id": batch_id}


@router.get("", response_model=list[BatchModel])
async def list_batches_endpoint(
    current_user: CurrentUser = Depends(get_current_user),
) -> list[BatchModel]:
    return list_batches(current_user["uid"])


@router.get("/{batch_id}", response_model=BatchModel)
async def get_batch_endpoint(
    batch_id: str,
    current_user: CurrentUser = Depends(get_current_user),
) -> BatchModel:
    batch = get_batch(batch_id, current_user["uid"])
    if batch is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Batch not found",
        )
    return batch


@router.delete("/{batch_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_batch_endpoint(
    batch_id: str,
    current_user: CurrentUser = Depends(get_current_user),
) -> None:
    ok = delete_batch(batch_id, current_user["uid"])
    if not ok:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Batch not found or access denied",
        )


from pydantic import BaseModel


class StudentBody(BaseModel):
    name: str
    email: str


@router.get("/{batch_id}/students", response_model=list[dict])
async def list_students_endpoint(
    batch_id: str,
    current_user: CurrentUser = Depends(get_current_user),
) -> list[dict]:
    lecturer_id: str = current_user["uid"]
    batch = get_batch(batch_id, lecturer_id)
    if batch is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Batch not found")
    return list_students(batch_id, lecturer_id)


@router.post("/{batch_id}/students", response_model=dict, status_code=status.HTTP_201_CREATED)
async def add_student_endpoint(
    batch_id: str,
    body: StudentBody,
    current_user: CurrentUser = Depends(get_current_user),
) -> dict:
    lecturer_id: str = current_user["uid"]
    batch = get_batch(batch_id, lecturer_id)
    if batch is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Batch not found")
    student_id = add_student_to_batch(batch_id, lecturer_id, body.name, body.email)
    return {"student_id": student_id}


@router.delete("/{batch_id}/students/{student_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_student_endpoint(
    batch_id: str,
    student_id: str,
    current_user: CurrentUser = Depends(get_current_user),
) -> None:
    lecturer_id: str = current_user["uid"]
    batch = get_batch(batch_id, lecturer_id)
    if batch is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Batch not found")
    remove_student_from_batch(batch_id, student_id)
