"""Google Cloud Storage helpers for the backend file upload pipeline."""

import logging
import os
import re
from pathlib import PurePath

logger = logging.getLogger(__name__)


def _get_bucket_name() -> str:
    name = (os.getenv("GCS_BUCKET_NAME") or "").strip()
    if not name:
        raise RuntimeError("GCS_BUCKET_NAME environment variable is not set.")
    return name


def _get_client():
    from google.cloud import storage  # type: ignore[import-untyped]
    return storage.Client()


def safe_file_name(file_name: str) -> str:
    """Strip path components and replace unsafe characters."""
    name = PurePath(file_name or "upload").name
    name = re.sub(r"[^\w.\- ]", "_", name).strip()
    return name or "upload"


def batch_upload_blob_path(
    lecturer_id: str,
    batch_id: str,
    file_id: str,
    file_name: str,
) -> str:
    safe_name = safe_file_name(file_name)
    return f"lecturers/{lecturer_id}/batches/{batch_id}/uploads/{file_id}/{safe_name}"


def upload_bytes(
    blob_path: str,
    data: bytes,
    content_type: str = "application/octet-stream",
) -> str:
    """Upload raw bytes. Returns the gs:// URI."""
    bucket_name = _get_bucket_name()
    client = _get_client()
    blob = client.bucket(bucket_name).blob(blob_path)
    blob.upload_from_string(data, content_type=content_type)
    logger.info("Uploaded %s bytes to gs://%s/%s", len(data), bucket_name, blob_path)
    return f"gs://{bucket_name}/{blob_path}"


def delete_blob(gcs_path: str) -> None:
    """Delete a GCS object by gs:// URI. Silently ignores 404."""
    if not gcs_path.startswith("gs://"):
        return
    without_prefix = gcs_path[5:]
    bucket_name, _, blob_path = without_prefix.partition("/")
    if not blob_path:
        return
    try:
        from google.api_core import exceptions as google_exceptions  # type: ignore[import-untyped]
        client = _get_client()
        client.bucket(bucket_name).blob(blob_path).delete()
        logger.info("Deleted gs://%s/%s", bucket_name, blob_path)
    except Exception as exc:
        if "404" in str(exc) or "Not Found" in str(exc):
            logger.debug("GCS object already gone: gs://%s/%s", bucket_name, blob_path)
        else:
            logger.warning("Failed to delete GCS object %s: %s", gcs_path, exc)


def delete_prefix(lecturer_id: str, batch_id: str) -> int:
    """Delete all objects under lecturers/{lecturer_id}/batches/{batch_id}/. Returns count."""
    prefix = f"lecturers/{lecturer_id}/batches/{batch_id}/"
    bucket_name = _get_bucket_name()
    client = _get_client()
    blobs = list(client.list_blobs(bucket_name, prefix=prefix))
    for blob in blobs:
        try:
            blob.delete()
        except Exception as exc:
            logger.warning("Failed to delete blob %s: %s", blob.name, exc)
    logger.info("Deleted %d objects under gs://%s/%s", len(blobs), bucket_name, prefix)
    return len(blobs)
