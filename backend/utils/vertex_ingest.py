"""Vertex AI Search ingest/delete helpers for the backend file pipeline."""

import hashlib
import json
import logging
import os
import uuid
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
    return "application/octet-stream"


def ingest_file(
    gcs_path: str,
    lecturer_id: str,
    batch_id: str,
    file_title: str,
    course_name: str = "",
    batch_name: str = "",
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
    operation.result(timeout=3600)
    logger.info("Indexed %s (doc_id=%s) into %s", gcs_path, doc_id, datastore_id)
    return doc_id


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
