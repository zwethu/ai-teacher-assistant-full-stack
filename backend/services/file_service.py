"""File upload pipeline: GCS → Firestore record → Vertex AI Search indexing."""

import logging
import uuid
import os
from datetime import datetime, timedelta, timezone
from typing import Any

from google.cloud.firestore import SERVER_TIMESTAMP

from entity.File import BatchFile
from utils.firestore_client import get_firestore
from utils.gcs import batch_upload_blob_path, delete_blob, upload_bytes, download_bytes
from google.cloud import firestore
from utils.vertex_ingest import delete_document, start_ingest_file
from utils.vertex_ingest import _doc_id as vertex_doc_id_for_file
from utils.vertex_ingest import _root_datastore_id
from services.cloud_tasks import QUEUE_INDEXING, enqueue

logger = logging.getLogger(__name__)

BATCHES_COLLECTION = "batches"
FILES_SUBCOLLECTION = "files"
PENDING_RESOURCES_SUBCOLLECTION = "pending_resources"
TRUNCATION_WARNING = "Only the first portion of this file is available immediately. Full durable indexing is still running."

# Poll cadence + ceiling for the check-indexing task chain (~1h expected window).
_CHECK_INDEXING_DELAY_SECONDS = 60
_CHECK_INDEXING_MAX_ATTEMPTS = 90  # ~90 min before handing back to the recovery sweep


def get_course_space_max_files() -> int:
    """Per-batch indexed-file cap (product guardrail; Vertex handles far more)."""
    try:
        return max(1, min(int(os.getenv("COURSE_SPACE_MAX_FILES", "50")), 10_000))
    except (TypeError, ValueError):
        return 50


def count_batch_files(batch_id: str) -> int:
    return sum(
        1 for _ in get_firestore()
        .collection(BATCHES_COLLECTION).document(batch_id)
        .collection(FILES_SUBCOLLECTION).stream()
    )

def _iso(value):
    return value.isoformat() if hasattr(value, "isoformat") else (str(value) if value else None)

def _grace_hours() -> int:
    try: value = int(os.getenv("OVERLAY_RETIRE_GRACE_HOURS", "24"))
    except ValueError: value = 24
    return max(1, min(value, 168))

def _pending_ref(batch_id: str, file_id: str):
    return get_firestore().collection(BATCHES_COLLECTION).document(batch_id).collection(PENDING_RESOURCES_SUBCOLLECTION).document(file_id)


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
        overlay_status=str(data.get("overlay_status") or "missing"),
        overlay_warning=str(data.get("overlay_warning") or ""),
        immediate_ready=str(data.get("overlay_status") or "") in {"ready", "retiring"},
        durable_index_ready=bool(data.get("durable_document_visible") or data.get("index_status") == "indexed"),
        durable_document_visible=bool(data.get("durable_document_visible", False)),
        durable_document_visible_at=_iso(data.get("durable_document_visible_at")),
        overlay_retire_after=_iso(data.get("overlay_retire_after")),
        overlay_retired_at=_iso(data.get("overlay_retired_at")),
        recovery_lease_owner=str(data.get("recovery_lease_owner") or ""),
        recovery_lease_until=_iso(data.get("recovery_lease_until")),
        recovery_attempt_count=int(data.get("recovery_attempt_count") or 0),
        last_recovery_at=_iso(data.get("last_recovery_at")),
        last_recovery_error=str(data.get("last_recovery_error") or ""),
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
            "index_status": "pending",
            "index_error": "",
            "index_message": "",
            "overlay_status": "missing", "overlay_warning": "",
            "durable_document_visible": False, "durable_document_visible_at": None,
            "overlay_retire_after": None, "overlay_retired_at": None,
            "created_at": SERVER_TIMESTAMP,
            "updated_at": SERVER_TIMESTAMP,
        }
    )
    build_pending_overlay(file_id, batch_id, lecturer_id, file_name, file_title or file_name, content_type, gcs_path, file_bytes)
    logger.info("Created file record %s for batch %s (overlay built, indexing queued)", file_id, batch_id)

    snap = file_doc.get()
    return _doc_to_model(file_id, snap.to_dict() or {})

def _course_token_estimate(file_bytes: bytes, content_type: str, char_len: int) -> int:
    from services.attachment_constants import CHARS_PER_TOKEN, TOKENS_PER_PDF_PAGE
    import io, math
    if content_type == "application/pdf":
        try:
            from pypdf import PdfReader
            return max(1, len(PdfReader(io.BytesIO(file_bytes)).pages)) * TOKENS_PER_PDF_PAGE
        except Exception:
            return max(TOKENS_PER_PDF_PAGE, (len(file_bytes) // 3_000) * TOKENS_PER_PDF_PAGE)
    return max(1, math.ceil(char_len / CHARS_PER_TOKEN))


def build_pending_overlay(file_id: str, batch_id: str, lecturer_id: str, file_name: str, file_title: str, content_type: str, gcs_path: str, file_bytes: bytes) -> None:
    file_ref = _file_ref(batch_id, file_id); resource_ref = _pending_ref(batch_id, file_id)
    try:
        if content_type == "application/msword":
            raise ValueError("Legacy DOC files do not support immediate extraction.")
        from services.document_extraction import extract_document, chunk_extraction
        from services.attachment_constants import NATIVE_READABLE_CONTENT_TYPES, get_max_native_read_tokens
        result = extract_document(file_bytes, content_type, 300_000)
        # Native-eligible: Gemini can read the original directly and it fits the budget.
        # Those are read natively by the agent during the indexing window (full fidelity);
        # oversized / non-native (docx/pptx) fall back to the lexical chunk overlay.
        token_estimate = _course_token_estimate(file_bytes, content_type, len(result.text))
        native_eligible = (
            content_type in NATIVE_READABLE_CONTENT_TYPES
            and token_estimate <= get_max_native_read_tokens()
        )
        chunks, truncated = ([], False) if native_eligible else chunk_extraction(result)
        if not native_eligible and not chunks:
            raise ValueError("No extractable text was found.")
        for index, chunk in enumerate(chunks):
            resource_ref.collection("chunks").document(f"{index:04d}").set({
                "chunk_id": f"{index:04d}", "batch_id": batch_id, "lecturer_id": lecturer_id,
                "resource_id": file_id, "file_id": file_id, "chunk_index": index,
                "text": chunk.text, "page_number": chunk.page_number,
                "char_count": len(chunk.text), "created_at": SERVER_TIMESTAMP,
            })
        for stale in resource_ref.collection("chunks").where("chunk_index", ">=", len(chunks)).stream():
            stale.reference.delete()
        warning = TRUNCATION_WARNING if truncated else ""
        resource_ref.set({
            "resource_id": file_id, "batch_id": batch_id, "lecturer_id": lecturer_id,
            "file_id": file_id, "file_name": file_name, "file_title": file_title,
            "content_type": content_type, "gcs_path": gcs_path, "status": "ready",
            "overlay_warning": warning, "chunk_count": len(chunks),
            "native_eligible": native_eligible, "token_estimate": token_estimate,
            "native_gcs_uri": gcs_path if native_eligible else "",
            "native_mime_type": content_type if native_eligible else "",
            "text_preview": result.text[:4000], "created_at": SERVER_TIMESTAMP, "updated_at": SERVER_TIMESTAMP,
        }, merge=True)
        file_ref.update({"overlay_status": "ready", "overlay_warning": warning, "index_message": "Ready for immediate use. Durable indexing is running.", "updated_at": SERVER_TIMESTAMP})
    except Exception as exc:
        error = str(exc)[:500]
        resource_ref.set({"resource_id": file_id, "batch_id": batch_id, "lecturer_id": lecturer_id, "file_id": file_id, "status": "failed", "overlay_warning": error, "updated_at": SERVER_TIMESTAMP}, merge=True)
        file_ref.update({"overlay_status": "failed", "overlay_warning": error, "updated_at": SERVER_TIMESTAMP})


def enqueue_index_batch_file(
    file_id: str,
    batch_id: str,
    gcs_path: str,
    lecturer_id: str,
    file_title: str,
    course_name: str = "",
    batch_name: str = "",
    *,
    background_tasks=None,
) -> None:
    """Queue durable Vertex indexing via Cloud Tasks (local: inline)."""
    enqueue(
        QUEUE_INDEXING, "/tasks/index-file",
        {
            "file_id": file_id, "batch_id": batch_id, "gcs_path": gcs_path,
            "lecturer_id": lecturer_id, "file_title": file_title,
            "course_name": course_name, "batch_name": batch_name,
        },
        background_tasks=background_tasks,
    )


def _claim_recovery(batch_id: str, file_id: str, owner: str, lease_minutes: int = 120) -> bool:
    ref = _file_ref(batch_id, file_id); tx = get_firestore().transaction(); now = datetime.now(timezone.utc)
    @firestore.transactional
    def claim(transaction):
        snap = ref.get(transaction=transaction); data = snap.to_dict() or {}
        until = data.get("recovery_lease_until")
        if not snap.exists or (until and until > now): return False
        transaction.update(ref, {"recovery_lease_owner": owner, "recovery_lease_until": now + timedelta(minutes=lease_minutes), "recovery_attempt_count": firestore.Increment(1), "last_recovery_at": now, "last_recovery_error": ""})
        return True
    return bool(claim(tx))

def _release_recovery(batch_id: str, file_id: str, owner: str, error: str = "") -> None:
    ref = _file_ref(batch_id, file_id); snap = ref.get(); data = snap.to_dict() or {}
    if data.get("recovery_lease_owner") == owner:
        ref.update({"recovery_lease_owner": "", "recovery_lease_until": None, "last_recovery_error": error[:500], "updated_at": SERVER_TIMESTAMP})


def run_index_file_task(
    file_id: str, batch_id: str, gcs_path: str, lecturer_id: str,
    file_title: str, course_name: str = "", batch_name: str = "",
) -> None:
    """Cloud Task: fire the Vertex import, then hand off to the check-indexing chain.

    Idempotent — a duplicate delivery that finds the file already past 'pending'/'indexing'
    (or unable to claim the lease) is a no-op.
    """
    file_doc = _file_ref(batch_id, file_id)
    owner = uuid.uuid4().hex
    if not _claim_recovery(batch_id, file_id, owner):
        return
    try:
        file_doc.update({"index_status": "indexing", "index_error": "",
                         "index_message": "Starting document import…", "updated_at": SERVER_TIMESTAMP})
        doc_id = start_ingest_file(
            gcs_path=gcs_path, lecturer_id=lecturer_id, batch_id=batch_id,
            file_title=file_title, course_name=course_name, batch_name=batch_name,
        )
        file_doc.update({
            "vertex_doc_id": doc_id, "index_status": "indexing",
            "vertex_import_completed_at": SERVER_TIMESTAMP,
            "index_message": "Waiting for durable index visibility.",
            "index_error": "", "updated_at": SERVER_TIMESTAMP,
        })
        enqueue(
            QUEUE_INDEXING, "/tasks/check-indexing",
            {"file_id": file_id, "batch_id": batch_id, "lecturer_id": lecturer_id, "attempt": 0},
            delay_seconds=_CHECK_INDEXING_DELAY_SECONDS,
        )
    except Exception as exc:
        err_msg = str(exc)[:500]
        logger.warning("Vertex import kickoff failed for file %s: %s", file_id, err_msg)
        file_doc.update({"index_status": "failed", "index_error": err_msg,
                         "index_message": "", "updated_at": SERVER_TIMESTAMP})
    finally:
        _release_recovery(batch_id, file_id, owner)


def run_check_indexing_task(file_id: str, batch_id: str, lecturer_id: str, attempt: int = 0) -> None:
    """Cloud Task: poll Vertex query-visibility; re-enqueue with a delay until visible
    or the attempt ceiling is hit (then the recovery sweep owns it)."""
    snap = _file_ref(batch_id, file_id).get()
    data = snap.to_dict() or {}
    if not snap.exists or str(data.get("index_status") or "") in {"indexed", "failed", "deleting"}:
        if str(data.get("index_status") or "") == "indexed":
            _retire_overlay_if_due(batch_id, file_id)
        return
    if _reconcile_visibility(batch_id, file_id, lecturer_id):
        return  # became visible -> indexed
    if attempt + 1 >= _CHECK_INDEXING_MAX_ATTEMPTS:
        _file_ref(batch_id, file_id).update({
            "index_message": "Indexing is taking longer than usual; it will finish in the background.",
            "updated_at": SERVER_TIMESTAMP,
        })
        return  # hand back to the periodic recovery sweep
    enqueue(
        QUEUE_INDEXING, "/tasks/check-indexing",
        {"file_id": file_id, "batch_id": batch_id, "lecturer_id": lecturer_id, "attempt": attempt + 1},
        delay_seconds=_CHECK_INDEXING_DELAY_SECONDS,
    )


def recover_batch_files(limit: int = 20) -> int:
    """Safety-net sweep: re-enqueue stuck files onto the task chain (no threads)."""
    db = get_firestore(); docs = []
    for status_value in ("pending", "indexing"):
        docs.extend(list(db.collection_group(FILES_SUBCOLLECTION).where("index_status", "==", status_value).limit(limit).stream()))
    docs.extend(list(db.collection_group(FILES_SUBCOLLECTION).where("overlay_status", "==", "retiring").limit(limit).stream()))
    processed = 0
    for doc in docs[:limit]:
        data = doc.to_dict() or {}
        batch_id = str(data.get("batch_id") or ""); file_id = doc.id
        lecturer_id = str(data.get("lecturer_id") or "")
        if not batch_id:
            continue
        try:
            if data.get("index_status") == "indexed":
                _retire_overlay_if_due(batch_id, file_id)
            elif data.get("vertex_import_completed_at"):
                # Import already fired — resume visibility polling.
                enqueue(QUEUE_INDEXING, "/tasks/check-indexing",
                        {"file_id": file_id, "batch_id": batch_id, "lecturer_id": lecturer_id, "attempt": 0})
            else:
                if str(data.get("overlay_status") or "missing") == "missing":
                    build_pending_overlay(file_id, batch_id, lecturer_id, str(data.get("file_name") or ""), str(data.get("file_title") or ""), str(data.get("content_type") or ""), str(data.get("gcs_path") or ""), download_bytes(str(data.get("gcs_path") or "")))
                batch = db.collection(BATCHES_COLLECTION).document(batch_id).get().to_dict() or {}
                enqueue_index_batch_file(file_id, batch_id, str(data.get("gcs_path") or ""), lecturer_id, str(data.get("file_title") or ""), str(batch.get("course_name") or ""), str(batch.get("batch_name") or ""))
            processed += 1
        except Exception as exc:
            logger.warning("recover_batch_files: file %s re-enqueue failed: %s", file_id, exc)
    return processed


def build_pending_course_materials_manifest(batch_id: str, lecturer_id: str, limit: int = 20) -> list[dict[str, Any]]:
    """Trusted manifest of just-uploaded, not-yet-indexed, native-eligible course files.

    Injected into agent session state so the agent can read them natively during the
    ~1h Vertex indexing window (full fidelity), instead of the lossy lexical overlay.
    Only native-eligible 'ready' overlays are included; the agent's per-run token budget
    bounds how many are actually read (the rest wait for indexing).
    """
    db = get_firestore()
    col = db.collection(BATCHES_COLLECTION).document(batch_id).collection(PENDING_RESOURCES_SUBCOLLECTION)
    manifest: list[dict[str, Any]] = []
    for doc in col.stream():
        data = doc.to_dict() or {}
        if (
            data.get("lecturer_id") != lecturer_id
            or data.get("status") != "ready"
            or not data.get("native_eligible")
            or not data.get("native_gcs_uri")
        ):
            continue
        manifest.append({
            "file_id": str(data.get("file_id") or doc.id),
            "file_title": str(data.get("file_title") or data.get("file_name") or ""),
            "native_gcs_uri": str(data.get("native_gcs_uri") or ""),
            "native_mime_type": str(data.get("native_mime_type") or "application/pdf"),
            "token_estimate": int(data.get("token_estimate") or 0),
            "status": "ready",
        })
        if len(manifest) >= limit:
            break
    return manifest


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
    if status in {"failed", "deleting"}:
        return _doc_to_model(snap.id, data)

    if status == "indexed":
        _retire_overlay_if_due(batch_id, file_id)
        snap = file_ref.get(); return _doc_to_model(snap.id, snap.to_dict() or {})

    _reconcile_visibility(batch_id, file_id, lecturer_id)
    snap = file_ref.get()
    return _doc_to_model(snap.id, snap.to_dict() or {})

def _document_is_searchable(doc: Any) -> tuple[bool, str]:
    """Return (is_searchable, pending_message) for a Vertex document.

    A document's RECORD exists (get_document succeeds) as soon as ImportDocuments is
    accepted, but it is not query-visible until Vertex finishes parsing/segmenting/
    embedding. Vertex populates Document.index_time (and index_status.index_time) only once
    the doc is actually searchable, and index_status.pending_message carries a human-readable
    reason while it is still processing. Gating on this — instead of mere existence — is what
    stops the UI reporting "Indexed" while the file is still parsing.

    Falls back to True if the installed client predates index_time (preserves legacy
    existence-based behavior rather than blocking forever).
    """
    pending_message = ""
    status = getattr(doc, "index_status", None)
    if status is not None:
        try:
            pending_message = str(getattr(status, "pending_message", "") or "")
        except Exception:
            pending_message = ""

    pb = getattr(doc, "_pb", None)
    if pb is None:
        return True, pending_message  # unknown client shape — legacy behavior
    try:
        if pb.HasField("index_time"):
            return True, pending_message
        status_pb = getattr(pb, "index_status", None)
        if status_pb is not None and status_pb.HasField("index_time"):
            return True, pending_message
        return False, pending_message
    except Exception:
        # Can't determine searchability from this proto — don't block indefinitely.
        return True, pending_message


def _reconcile_visibility(batch_id: str, file_id: str, lecturer_id: str) -> bool:
    file_ref = _file_ref(batch_id, file_id); snap = file_ref.get(); data = snap.to_dict() or {}

    gcs_path = str(data.get("gcs_path") or "")
    datastore_id = _root_datastore_id()
    if not datastore_id or not gcs_path:
        file_ref.update({"index_message": "Index status cannot be synced yet.", "index_error": "Missing Vertex datastore id or GCS path.", "updated_at": SERVER_TIMESTAMP})
        return False

    doc_id = vertex_doc_id_for_file(lecturer_id, batch_id, gcs_path)
    doc_name = f"{datastore_id.rstrip('/')}/branches/0/documents/{doc_id}"

    try:
        from google.api_core import exceptions as google_exceptions  # type: ignore[import-untyped]
        from google.cloud import discoveryengine_v1 as discoveryengine  # type: ignore[import-untyped]

        client = discoveryengine.DocumentServiceClient()
        doc = client.get_document(name=doc_name)
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
            return False

        err_msg = str(exc)[:500]
        logger.warning("Vertex index sync failed for file %s: %s", file_id, err_msg)
        file_ref.update({"index_message": "Could not verify Vertex index status yet.", "index_error": err_msg, "updated_at": SERVER_TIMESTAMP})
        return False

    # The record exists, but is it actually searchable yet? Gate on index_time — not mere
    # existence — so we don't flip to "indexed" (and start retiring the immediate overlay)
    # while Vertex is still parsing. The check-indexing poll keeps calling until searchable.
    indexed, pending_message = _document_is_searchable(doc)
    if not indexed:
        message = pending_message or "Document imported; Vertex is still processing it for search."
        file_ref.update(
            {
                "vertex_doc_id": doc_id,
                "index_status": "indexing",
                "index_message": message,
                "updated_at": SERVER_TIMESTAMP,
            }
        )
        data.update({"index_status": "indexing", "index_message": message})
        return False

    now = datetime.now(timezone.utc)
    updates = {
        "vertex_doc_id": doc_id, "index_status": "indexed",
        "durable_document_visible": True, "durable_document_visible_at": now,
        "index_error": "", "updated_at": SERVER_TIMESTAMP,
    }
    if str(data.get("overlay_status") or "") == "ready":
        updates.update({"overlay_status": "retiring", "overlay_retire_after": now + timedelta(hours=_grace_hours()), "index_message": "Indexed. Immediate overlay will be retained briefly while search availability settles."})
    else:
        updates["index_message"] = ""
    file_ref.update(updates)
    return True

def _delete_pending_chunks(batch_id: str, file_id: str) -> None:
    resource_ref = _pending_ref(batch_id, file_id)
    for chunk in resource_ref.collection("chunks").stream():
        chunk.reference.delete()

def _retire_overlay_if_due(batch_id: str, file_id: str, force: bool = False) -> bool:
    file_ref = _file_ref(batch_id, file_id); snap = file_ref.get(); data = snap.to_dict() or {}
    if str(data.get("overlay_status") or "") not in {"ready", "retiring"}: return False
    retire_after = data.get("overlay_retire_after")
    if not force and (not retire_after or retire_after > datetime.now(timezone.utc)): return False
    _delete_pending_chunks(batch_id, file_id)
    _pending_ref(batch_id, file_id).set({"status": "retired", "updated_at": SERVER_TIMESTAMP}, merge=True)
    file_ref.update({"overlay_status": "retired", "overlay_retired_at": SERVER_TIMESTAMP, "index_message": "", "updated_at": SERVER_TIMESTAMP})
    return True

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

    _delete_pending_chunks(batch_id, file_id)
    _pending_ref(batch_id, file_id).delete()

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
        _delete_pending_chunks(batch_id, doc.id)
        _pending_ref(batch_id, doc.id).delete()
        doc.reference.delete()
    logger.info("Deleted all files for batch %s", batch_id)
