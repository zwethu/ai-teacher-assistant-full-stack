"""File upload pipeline: GCS → Firestore record → Vertex AI Search indexing."""

import logging
import threading
import uuid
from typing import Any

from google.cloud.firestore import SERVER_TIMESTAMP

from entity.File import BatchFile
from utils.firestore_client import get_firestore
from utils.gcs import batch_upload_blob_path, delete_blob, upload_bytes
from utils.vertex_ingest import delete_document, ingest_file
from utils.vertex_ingest import _doc_id as vertex_doc_id_for_file
from utils.vertex_ingest import _root_datastore_id

logger = logging.getLogger(__name__)

BATCHES_COLLECTION = "batches"
FILES_SUBCOLLECTION = "files"


def _file_ref(batch_id: str, file_id: str):
    return (
        get_firestore()
        .collection(BATCHES_COLLECTION)
        .document(batch_id)
        .collection(FILES_SUBCOLLECTION)
        .document(file_id)
    )


def _doc_to_model(doc_id: str, data: dict[str, Any]) -> BatchFile:
    created = data.get("created_at")
    updated = data.get("updated_at")
    return BatchFile(
        file_id=doc_id,
        batch_id=str(data.get("batch_id") or ""),
        lecturer_id=str(data.get("lecturer_id") or ""),
        file_name=str(data.get("file_name") or ""),
        file_title=str(data.get("file_title") or data.get("file_name") or ""),
        content_type=str(data.get("content_type") or "application/octet-stream"),
        gcs_path=str(data.get("gcs_path") or ""),
        vertex_doc_id=str(data.get("vertex_doc_id") or ""),
        index_status=str(data.get("index_status") or "uploading"),
        index_error=str(data.get("index_error") or ""),
        index_message=str(data.get("index_message") or ""),
        created_at=str(created.isoformat()) if hasattr(created, "isoformat") else (str(created) if created else None),
        updated_at=str(updated.isoformat()) if hasattr(updated, "isoformat") else (str(updated) if updated else None),
    )


def upload_batch_file(
    file_bytes: bytes,
    file_name: str,
    file_title: str,
    content_type: str,
    batch_id: str,
    lecturer_id: str,
    course_name: str = "",
    batch_name: str = "",
) -> BatchFile:
    """
    Upload file to GCS and write Firestore record with index_status=indexing.
    Returns immediately; call index_batch_file via BackgroundTasks to index.
    """
    db = get_firestore()
    file_id = str(uuid.uuid4())

    blob_path = batch_upload_blob_path(lecturer_id, batch_id, file_id, file_name)
    gcs_path = upload_bytes(blob_path, file_bytes, content_type)

    batch_ref = db.collection(BATCHES_COLLECTION).document(batch_id)
    file_doc = batch_ref.collection(FILES_SUBCOLLECTION).document(file_id)
    file_doc.set(
        {
            "file_id": file_id,
            "batch_id": batch_id,
            "lecturer_id": lecturer_id,
            "file_name": file_name,
            "file_title": file_title or file_name,
            "content_type": content_type,
            "gcs_path": gcs_path,
            "vertex_doc_id": "",
            "index_status": "indexing",
            "index_error": "",
            "index_message": "",
            "created_at": SERVER_TIMESTAMP,
            "updated_at": SERVER_TIMESTAMP,
        }
    )
    logger.info("Created file record %s for batch %s (indexing queued)", file_id, batch_id)

    snap = file_doc.get()
    return _doc_to_model(file_id, snap.to_dict() or {})


def enqueue_index_batch_file(
    file_id: str,
    batch_id: str,
    gcs_path: str,
    lecturer_id: str,
    file_title: str,
    course_name: str = "",
    batch_name: str = "",
) -> None:
    """Run indexing in a daemon thread so uploads/reloads are not blocked.

    TODO: Move production indexing to Cloud Tasks, a Cloud Run job, or a
    dedicated worker so it does not rely on process-local daemon threads.
    """
    thread = threading.Thread(
        target=index_batch_file,
        kwargs={
            "file_id": file_id,
            "batch_id": batch_id,
            "gcs_path": gcs_path,
            "lecturer_id": lecturer_id,
            "file_title": file_title,
            "course_name": course_name,
            "batch_name": batch_name,
        },
        daemon=True,
        name=f"index-{file_id[:8]}",
    )
    thread.start()


def index_batch_file(
    file_id: str,
    batch_id: str,
    gcs_path: str,
    lecturer_id: str,
    file_title: str,
    course_name: str = "",
    batch_name: str = "",
) -> None:
    """Run Vertex indexing in a background worker and update the Firestore record."""
    file_doc = _file_ref(batch_id, file_id)

    def _on_progress(message: str) -> None:
        try:
            file_doc.update({"index_message": message, "updated_at": SERVER_TIMESTAMP})
        except Exception:
            pass

    try:
        _on_progress("Starting document import…")
        doc_id = ingest_file(
            gcs_path=gcs_path,
            lecturer_id=lecturer_id,
            batch_id=batch_id,
            file_title=file_title,
            course_name=course_name,
            batch_name=batch_name,
            on_progress=_on_progress,
        )
        file_doc.update(
            {
                "vertex_doc_id": doc_id,
                "index_status": "indexed",
                "index_message": "",
                "index_error": "",
                "updated_at": SERVER_TIMESTAMP,
            }
        )
        logger.info("File %s indexed as %s", file_id, doc_id)
    except Exception as exc:
        err_msg = str(exc)[:500]
        logger.warning("Vertex indexing failed for file %s: %s", file_id, err_msg)
        file_doc.update(
            {
                "index_status": "failed",
                "index_error": err_msg,
                "index_message": "",
                "updated_at": SERVER_TIMESTAMP,
            }
        )


def list_batch_files(batch_id: str, lecturer_id: str) -> list[BatchFile]:
    """Return all file records for a batch (after ownership verification)."""
    db = get_firestore()
    batch_snap = db.collection(BATCHES_COLLECTION).document(batch_id).get()
    if not batch_snap.exists or (batch_snap.to_dict() or {}).get("lecturer_id") != lecturer_id:
        return []
    col = (
        db.collection(BATCHES_COLLECTION)
        .document(batch_id)
        .collection(FILES_SUBCOLLECTION)
    )
    return [
        _doc_to_model(doc.id, doc.to_dict() or {})
        for doc in col.order_by("created_at").stream()
    ]


def get_batch_file(batch_id: str, file_id: str, lecturer_id: str) -> BatchFile | None:
    """Return a single batch file after ownership verification."""
    snap = _file_ref(batch_id, file_id).get()
    if not snap.exists:
        return None
    data = snap.to_dict() or {}
    if data.get("lecturer_id") != lecturer_id:
        return None
    return _doc_to_model(snap.id, data)


def sync_index_status(batch_id: str, file_id: str, lecturer_id: str) -> BatchFile | None:
    """Reconcile Firestore index state with Vertex AI Search visibility."""
    file_ref = _file_ref(batch_id, file_id)
    snap = file_ref.get()
    if not snap.exists:
        return None

    data = snap.to_dict() or {}
    if data.get("lecturer_id") != lecturer_id:
        return None

    status = str(data.get("index_status") or "")
    if status in {"indexed", "failed", "deleting"}:
        return _doc_to_model(snap.id, data)

    gcs_path = str(data.get("gcs_path") or "")
    datastore_id = _root_datastore_id()
    if not datastore_id or not gcs_path:
        data["index_message"] = "Index status cannot be synced yet."
        data["index_error"] = "Missing Vertex datastore id or GCS path."
        return _doc_to_model(snap.id, data)

    doc_id = vertex_doc_id_for_file(lecturer_id, batch_id, gcs_path)
    doc_name = f"{datastore_id.rstrip('/')}/branches/0/documents/{doc_id}"

    try:
        from google.api_core import exceptions as google_exceptions  # type: ignore[import-untyped]
        from google.cloud import discoveryengine_v1 as discoveryengine  # type: ignore[import-untyped]

        client = discoveryengine.DocumentServiceClient()
        client.get_document(name=doc_name)
    except Exception as exc:
        if "google_exceptions" in locals() and isinstance(exc, google_exceptions.NotFound):
            file_ref.update(
                {
                    "index_status": "indexing",
                    "index_message": "Waiting for Vertex index visibility...",
                    "updated_at": SERVER_TIMESTAMP,
                }
            )
            data.update(
                {
                    "index_status": "indexing",
                    "index_message": "Waiting for Vertex index visibility...",
                }
            )
            return _doc_to_model(snap.id, data)

        err_msg = str(exc)[:500]
        logger.warning("Vertex index sync failed for file %s: %s", file_id, err_msg)
        data["index_message"] = "Could not verify Vertex index status yet."
        data["index_error"] = err_msg
        return _doc_to_model(snap.id, data)

    file_ref.update(
        {
            "vertex_doc_id": doc_id,
            "index_status": "indexed",
            "index_message": "",
            "index_error": "",
            "updated_at": SERVER_TIMESTAMP,
        }
    )
    data.update(
        {
            "vertex_doc_id": doc_id,
            "index_status": "indexed",
            "index_message": "",
            "index_error": "",
        }
    )
    return _doc_to_model(snap.id, data)


def delete_batch_file(
    batch_id: str,
    file_id: str,
    lecturer_id: str,
) -> bool:
    """Delete GCS object, Vertex document, and Firestore record. Returns False if not found/owned."""
    db = get_firestore()
    file_ref = _file_ref(batch_id, file_id)
    snap = file_ref.get()
    if not snap.exists:
        return False
    data = snap.to_dict() or {}
    if data.get("lecturer_id") != lecturer_id:
        return False

    file_ref.update({"index_status": "deleting", "updated_at": SERVER_TIMESTAMP})

    gcs_path = str(data.get("gcs_path") or "")
    if gcs_path:
        delete_blob(gcs_path)

    vertex_doc_id = str(data.get("vertex_doc_id") or "")
    if vertex_doc_id:
        delete_document(vertex_doc_id)

    file_ref.delete()
    logger.info("Deleted file %s from batch %s", file_id, batch_id)
    return True


def delete_all_batch_files(batch_id: str, lecturer_id: str) -> None:
    """Delete every file record (GCS + Vertex + Firestore) for a batch."""
    db = get_firestore()
    col = (
        db.collection(BATCHES_COLLECTION)
        .document(batch_id)
        .collection(FILES_SUBCOLLECTION)
    )
    for doc in col.stream():
        data = doc.to_dict() or {}
        gcs_path = str(data.get("gcs_path") or "")
        if gcs_path:
            delete_blob(gcs_path)
        vertex_doc_id = str(data.get("vertex_doc_id") or "")
        if vertex_doc_id:
            delete_document(vertex_doc_id)
        doc.reference.delete()
    logger.info("Deleted all files for batch %s", batch_id)
