"""Vertex AI Search ingest/delete helpers for the backend file pipeline."""

import hashlib
import json
import logging
import os
import time
import uuid
from collections.abc import Callable
from typing import Any

logger = logging.getLogger(__name__)

_LOCATION = "global"
_COLLECTION = "default_collection"
_DEFAULT_BRANCH = "0"


def _root_datastore_id() -> str:
    return (os.getenv("VERTEX_ROOT_DATASTORE_ID") or "").strip()


def _doc_id(lecturer_id: str, batch_id: str, gcs_path: str) -> str:
    """Deterministic RFC-1034 doc ID matching Pnai-ai derivation."""
    unique_str = f"{lecturer_id}:{batch_id}:{gcs_path}"
    hash_val = hashlib.sha256(unique_str.encode()).hexdigest()[:16]
    return f"doc-{hash_val}"


def _import_parent(datastore_id: str) -> str:
    return f"{datastore_id.rstrip('/')}/branches/{_DEFAULT_BRANCH}"


def _manifest_blob_path(lecturer_id: str, batch_id: str, doc_id: str) -> str:
    return (
        f"lecturers/{lecturer_id}/batches/{batch_id}"
        f"/manifests/{doc_id}-{uuid.uuid4().hex[:8]}.jsonl"
    )


def _mime_type(file_name: str) -> str:
    lower = file_name.lower()
    if lower.endswith(".pdf"):
        return "application/pdf"
    if lower.endswith(".txt") or lower.endswith(".md"):
        return "text/plain"
    if lower.endswith(".json"):
        return "application/json"
    if lower.endswith(".docx"):
        return "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    if lower.endswith(".doc"):
        return "application/msword"
    return "application/octet-stream"


def ingest_file(
    gcs_path: str,
    lecturer_id: str,
    batch_id: str,
    file_title: str,
    course_name: str = "",
    batch_name: str = "",
    on_progress: Callable[[str], None] | None = None,
) -> str:
    """
    Upload a JSONL manifest and trigger Vertex AI Search ImportDocuments.
    Returns the document ID on success, raises RuntimeError on failure.
    """
    datastore_id = _root_datastore_id()
    if not datastore_id:
        raise RuntimeError(
            "VERTEX_ROOT_DATASTORE_ID is not configured — cannot index file."
        )

    doc_id = _doc_id(lecturer_id, batch_id, gcs_path)
    file_name = gcs_path.rsplit("/", 1)[-1]

    struct_data: dict[str, Any] = {
        "lecturer_id": lecturer_id,
        "batch_id": batch_id,
        "batch_name": batch_name,
        "course_name": course_name,
        "source_type": "teacher_upload",
        "material_type": file_name.rsplit(".", 1)[-1].lower() if "." in file_name else "unknown",
        "file_title": file_title or file_name,
    }

    manifest = {
        "id": doc_id,
        "content": {
            "mimeType": _mime_type(file_name),
            "uri": gcs_path,
        },
        "structData": struct_data,
    }
    jsonl_bytes = (json.dumps(manifest) + "\n").encode("utf-8")

    bucket_name = _parse_gcs_bucket(gcs_path)
    manifest_blob = _manifest_blob_path(lecturer_id, batch_id, doc_id)

    from google.cloud import storage as gcs_lib  # type: ignore[import-untyped]
    from google.cloud import discoveryengine_v1 as discoveryengine  # type: ignore[import-untyped]
    from google.cloud.discoveryengine_v1.types import GcsSource, ImportDocumentsRequest  # type: ignore[import-untyped]

    gcs_client = gcs_lib.Client()
    blob = gcs_client.bucket(bucket_name).blob(manifest_blob)
    blob.upload_from_string(jsonl_bytes, content_type="application/jsonl")
    manifest_uri = f"gs://{bucket_name}/{manifest_blob}"
    logger.info("Uploaded Vertex manifest to %s", manifest_uri)

    de_client = discoveryengine.DocumentServiceClient()
    request = ImportDocumentsRequest(
        parent=_import_parent(datastore_id),
        gcs_source=GcsSource(
            input_uris=[manifest_uri],
            data_schema="document",
        ),
        reconciliation_mode=ImportDocumentsRequest.ReconciliationMode.INCREMENTAL,
    )
    operation = de_client.import_documents(request=request)

    deadline = time.time() + 3600
    last_message = ""
    if on_progress:
        on_progress("Waiting for Vertex import to start…")
        last_message = "Waiting for Vertex import to start…"

    while time.time() < deadline:
        try:
            operation.reload()
        except Exception:
            pass

        if operation.done():
            break

        if on_progress:
            try:
                msg = _extract_progress_message(operation.metadata)
                if not msg:
                    msg = "Indexing in progress…"
                if msg != last_message:
                    last_message = msg
                    on_progress(msg)
            except Exception:
                pass
        time.sleep(5)

    operation.result(timeout=60)
    logger.info("Indexed %s (doc_id=%s) into %s", gcs_path, doc_id, datastore_id)
    return doc_id


def _extract_progress_message(meta) -> str:
    """Extract human-readable progress from ImportDocumentsMetadata."""
    if meta is None:
        return ""

    state_map = {
        0: "Preparing document import…",
        1: "Document crawling has finished.",
        2: "Document parsing is working in progress.",
        3: "Document segmentation will start later.",
        4: "Indexing complete.",
        "STATE_UNSPECIFIED": "Preparing document import…",
        "IMPORTING": "Importing documents…",
        "SUCCEEDED": "Indexing complete.",
        "FAILED": "Import failed.",
        "CANCELLED": "Import cancelled.",
    }

    try:
        state = getattr(meta, "state", None)
        if state is not None:
            state_name = getattr(state, "name", None)
            if state_name and state_name in state_map:
                return state_map[state_name]
            try:
                state_val = int(state)
                if state_val in state_map:
                    return state_map[state_val]
            except (TypeError, ValueError):
                pass

        statuses = getattr(meta, "individual_import_statuses", None) or []
        for item in statuses:
            doc_id = getattr(item, "document_id", "") or getattr(item, "documentId", "")
            item_state = getattr(item, "state", None)
            item_name = getattr(item_state, "name", str(item_state)) if item_state else ""
            if doc_id:
                return f"Processing {doc_id} ({item_name or 'running'})…"

        try:
            from google.protobuf.json_format import MessageToDict

            data = MessageToDict(meta._pb) if hasattr(meta, "_pb") else MessageToDict(meta)
            for key in ("progressMessage", "progress_message", "message"):
                if data.get(key):
                    return str(data[key])
        except Exception:
            pass
    except Exception:
        return ""

    return ""


def delete_document(doc_id: str) -> None:
    """Delete a document from the root datastore. Silently ignores 404."""
    datastore_id = _root_datastore_id()
    if not datastore_id or not doc_id:
        return
    doc_name = f"{_import_parent(datastore_id)}/documents/{doc_id}"
    try:
        from google.cloud import discoveryengine_v1 as discoveryengine  # type: ignore[import-untyped]
        from google.api_core import exceptions as google_exceptions  # type: ignore[import-untyped]
        client = discoveryengine.DocumentServiceClient()
        client.delete_document(name=doc_name)
        logger.info("Deleted Vertex document %s", doc_id)
    except Exception as exc:
        if "404" in str(exc) or "NOT_FOUND" in str(exc):
            logger.debug("Vertex document already gone: %s", doc_id)
        else:
            logger.warning("Failed to delete Vertex document %s: %s", doc_id, exc)


def _parse_gcs_bucket(gcs_path: str) -> str:
    if not gcs_path.startswith("gs://"):
        raise ValueError(f"Invalid GCS path: {gcs_path}")
    return gcs_path[5:].split("/")[0]
