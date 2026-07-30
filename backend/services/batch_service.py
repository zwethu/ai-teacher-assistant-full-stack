import hashlib
import logging
import os
from typing import Any

from google.cloud import firestore
from google.cloud.firestore import SERVER_TIMESTAMP
from google.cloud.firestore_v1 import Increment

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

    batch_ref = db.collection(BATCHES_COLLECTION).document(batch_id)
    transaction = db.transaction()

    @firestore.transactional
    def _txn(txn):
        txn.set(
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
        txn.update(
            batch_ref,
            {"student_count": Increment(1), "updated_at": SERVER_TIMESTAMP},
        )

    _txn(transaction)
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
    batch_ref = db.collection(BATCHES_COLLECTION).document(batch_id)
    transaction = db.transaction()

    @firestore.transactional
    def _txn(txn):
        txn.delete(student_ref)
        txn.update(
            batch_ref,
            {
                "student_count": Increment(-1),
                "updated_at": SERVER_TIMESTAMP,
            },
        )

    _txn(transaction)


def list_students(batch_id: str, lecturer_id: str) -> list[dict[str, Any]]:
    """Return all students for a batch (after verifying lecturer ownership)."""
    db = get_firestore()
    batch_ref = db.collection(BATCHES_COLLECTION).document(batch_id)
    snap = batch_ref.get()
    if not snap.exists or (snap.to_dict() or {}).get("lecturer_id") != lecturer_id:
        return []

    students_ref = batch_ref.collection(STUDENTS_SUBCOLLECTION)
    results: list[dict[str, Any]] = []
    for doc in students_ref.order_by("created_at").stream():
        data = doc.to_dict() or {}
        created = data.get("created_at")
        updated = data.get("updated_at")
        results.append(
            {
                "id": doc.id,
                "batch_id": str(data.get("batch_id") or batch_id),
                "lecturer_id": str(data.get("lecturer_id") or ""),
                "name": str(data.get("name") or ""),
                "email": str(data.get("email") or ""),
                "email_normalized": str(data.get("email_normalized") or ""),
                "status": str(data.get("status") or "active"),
                "created_at": (
                    created.isoformat() if hasattr(created, "isoformat") else (str(created) if created else None)
                ),
                "updated_at": (
                    updated.isoformat() if hasattr(updated, "isoformat") else (str(updated) if updated else None)
                ),
            }
        )
    return results


def delete_batch(batch_id: str, lecturer_id: str) -> bool:
    """
    Full batch teardown:
      1. Delete all files (GCS objects + Vertex docs + Firestore records)
      2. Delete GCS prefix remainder (manifests, artifacts, etc.)
      3. Delete all chats + messages
      4. Delete students subcollection
      5. Delete Course Blueprint versions
      6. Delete the batch document itself
    Returns False if not found or not owned by lecturer_id.
    """
    db = get_firestore()
    batch_ref = db.collection(BATCHES_COLLECTION).document(batch_id)
    snap = batch_ref.get()
    if not snap.exists:
        return False
    data = snap.to_dict() or {}
    if data.get("lecturer_id") != lecturer_id:
        return False

    # 1. Files: GCS blobs + Vertex docs + Firestore records
    try:
        from services.file_service import delete_all_batch_files
        delete_all_batch_files(batch_id, lecturer_id)
    except Exception as exc:
        logger.warning("Error deleting batch files for %s: %s", batch_id, exc)

    # 2. GCS prefix (manifests, artifacts, leftover uploads)
    try:
        from utils.gcs import delete_prefix
        delete_prefix(lecturer_id, batch_id)
    except Exception as exc:
        logger.warning("Error deleting GCS prefix for %s: %s", batch_id, exc)

    # 3. Chats + messages
    try:
        from services.chat_service import delete_all_batch_chats
        delete_all_batch_chats(batch_id)
    except Exception as exc:
        logger.warning("Error deleting batch chats for %s: %s", batch_id, exc)

    # 4. Students
    for student_doc in batch_ref.collection(STUDENTS_SUBCOLLECTION).stream():
        student_doc.reference.delete()

    # 5. Course Blueprint versions (Firestore does not cascade subcollections)
    for blueprint_doc in batch_ref.collection("course_blueprints").stream():
        blueprint_doc.reference.delete()

    # 6. Batch document
    batch_ref.delete()
    logger.info("Deleted batch %s and all associated data", batch_id)
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
