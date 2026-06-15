import hashlib
import logging
import os
from typing import Any

from google.cloud.firestore import FieldValue, SERVER_TIMESTAMP

from entity.Batch import BatchCreate, BatchModel
from utils.firestore_client import get_firestore

logger = logging.getLogger(__name__)

BATCHES_COLLECTION = "batches"
STUDENTS_SUBCOLLECTION = "students"


def _student_id(email: str) -> str:
    """Deterministic 16-char hex ID from the normalised email — prevents per-batch duplicates."""
    normalised = email.lower().strip()
    return hashlib.sha256(normalised.encode()).hexdigest()[:16]


def _datastore_id_from_env() -> str:
    return os.getenv("VERTEX_ROOT_DATASTORE_ID", "")


def create_batch(
    payload: BatchCreate,
    lecturer_id: str,
    lecturer_email: str,
) -> str:
    """Create the batch document, students subcollection and return the new batch_id."""
    db = get_firestore()
    datastore_id = _datastore_id_from_env()

    batch_ref = db.collection(BATCHES_COLLECTION).document()
    batch_id = batch_ref.id
    storage_prefix = f"lecturers/{lecturer_id}/batches/{batch_id}"

    valid_students = [
        s for s in payload.students if s.name.strip() and s.email.strip()
    ]

    batch_data: dict[str, Any] = {
        "batch_id": batch_id,
        "batch_name": payload.batch_name.strip(),
        "course_name": payload.course_name.strip(),
        "lecturer_id": lecturer_id,
        "lecturer_email": lecturer_email,
        "datastore_id": datastore_id,
        "storage_prefix": storage_prefix,
        "academic_year": payload.academic_year.strip(),
        "term": payload.term.strip(),
        "student_count": len(valid_students),
        "status": "active",
        "created_at": SERVER_TIMESTAMP,
        "updated_at": SERVER_TIMESTAMP,
    }
    batch_ref.set(batch_data)

    for student in valid_students:
        student_id = _student_id(student.email)
        student_ref = (
            db.collection(BATCHES_COLLECTION)
            .document(batch_id)
            .collection(STUDENTS_SUBCOLLECTION)
            .document(student_id)
        )
        student_ref.set(
            {
                "batch_id": batch_id,
                "lecturer_id": lecturer_id,
                "name": student.name.strip(),
                "email": student.email.strip(),
                "email_normalized": student.email.lower().strip(),
                "status": "active",
                "created_at": SERVER_TIMESTAMP,
                "updated_at": SERVER_TIMESTAMP,
            }
        )

    return batch_id


def list_batches(lecturer_id: str) -> list[BatchModel]:
    """Return all batches for a lecturer ordered by creation time descending."""
    db = get_firestore()
    docs = (
        db.collection(BATCHES_COLLECTION)
        .where("lecturer_id", "==", lecturer_id)
        .order_by("created_at", direction="DESCENDING")
        .stream()
    )
    results: list[BatchModel] = []
    for doc in docs:
        data = doc.to_dict() or {}
        results.append(_doc_to_model(doc.id, data))
    return results


def get_batch(batch_id: str, lecturer_id: str) -> BatchModel | None:
    """Return a single batch, verifying lecturer ownership."""
    db = get_firestore()
    doc = db.collection(BATCHES_COLLECTION).document(batch_id).get()
    if not doc.exists:
        return None
    data = doc.to_dict() or {}
    if data.get("lecturer_id") != lecturer_id:
        return None
    return _doc_to_model(doc.id, data)


def add_student_to_batch(
    batch_id: str,
    lecturer_id: str,
    name: str,
    email: str,
) -> str:
    """Add a student (idempotent by email hash). Increments student_count atomically."""
    db = get_firestore()
    student_id = _student_id(email)
    student_ref = (
        db.collection(BATCHES_COLLECTION)
        .document(batch_id)
        .collection(STUDENTS_SUBCOLLECTION)
        .document(student_id)
    )
    if student_ref.get().exists:
        return student_id

    @db.transaction()
    def _txn(transaction):
        transaction.set(
            student_ref,
            {
                "batch_id": batch_id,
                "lecturer_id": lecturer_id,
                "name": name.strip(),
                "email": email.strip(),
                "email_normalized": email.lower().strip(),
                "status": "active",
                "created_at": SERVER_TIMESTAMP,
                "updated_at": SERVER_TIMESTAMP,
            },
        )
        transaction.update(
            db.collection(BATCHES_COLLECTION).document(batch_id),
            {"student_count": FieldValue.increment(1), "updated_at": SERVER_TIMESTAMP},
        )

    _txn()
    return student_id


def remove_student_from_batch(
    batch_id: str,
    student_id: str,
) -> None:
    """Delete a student document and decrement student_count atomically."""
    db = get_firestore()
    student_ref = (
        db.collection(BATCHES_COLLECTION)
        .document(batch_id)
        .collection(STUDENTS_SUBCOLLECTION)
        .document(student_id)
    )

    @db.transaction()
    def _txn(transaction):
        transaction.delete(student_ref)
        transaction.update(
            db.collection(BATCHES_COLLECTION).document(batch_id),
            {
                "student_count": FieldValue.increment(-1),
                "updated_at": SERVER_TIMESTAMP,
            },
        )

    _txn()


def delete_batch(batch_id: str, lecturer_id: str) -> bool:
    """Delete students subcollection then the batch document. Returns False if not found/owned."""
    db = get_firestore()
    batch_ref = db.collection(BATCHES_COLLECTION).document(batch_id)
    snap = batch_ref.get()
    if not snap.exists:
        return False
    if (snap.to_dict() or {}).get("lecturer_id") != lecturer_id:
        return False

    students_ref = batch_ref.collection(STUDENTS_SUBCOLLECTION)
    for student_doc in students_ref.stream():
        student_doc.reference.delete()

    batch_ref.delete()
    return True


def _doc_to_model(doc_id: str, data: dict[str, Any]) -> BatchModel:
    created = data.get("created_at")
    updated = data.get("updated_at")
    return BatchModel(
        batch_id=doc_id,
        batch_name=str(data.get("batch_name") or ""),
        course_name=str(data.get("course_name") or ""),
        lecturer_id=str(data.get("lecturer_id") or ""),
        lecturer_email=str(data.get("lecturer_email") or ""),
        datastore_id=str(data.get("datastore_id") or ""),
        storage_prefix=str(data.get("storage_prefix") or ""),
        academic_year=str(data.get("academic_year") or ""),
        term=str(data.get("term") or ""),
        student_count=int(data.get("student_count") or 0),
        status=str(data.get("status") or "active"),
        created_at=str(created.isoformat()) if hasattr(created, "isoformat") else (str(created) if created else None),
        updated_at=str(updated.isoformat()) if hasattr(updated, "isoformat") else (str(updated) if updated else None),
    )
