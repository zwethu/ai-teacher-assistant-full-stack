"""Build and maintain temporary, chat-scoped attachment chunks."""
from __future__ import annotations

import hashlib
import math
import os
from datetime import datetime, timezone
from typing import Any

from google.cloud.firestore import SERVER_TIMESTAMP
from google.cloud.firestore_v1.vector import Vector

from services.attachment_constants import (
    MAX_EXTRACTED_PREVIEW_CHARS,
    get_chat_rag_max_chunks,
    get_chat_rag_max_extracted_chars,
)
from services.chat_embedding_service import (
    embed_texts,
    embedding_dimensions,
    embeddings_enabled,
)
from services.document_extraction import ExtractedSegment, ExtractionResult, chunk_extraction, extract_document
from utils.firestore_client import get_firestore


def rag_enabled() -> bool:
    return os.getenv("CHAT_FILE_RAG_ENABLED", "false").lower() == "true"


def _attachment_ref(batch_id: str, chat_id: str, attachment_id: str):
    return get_firestore().collection("batches").document(batch_id).collection("chats").document(chat_id).collection("attachments").document(attachment_id)


def delete_attachment_chunks(batch_id: str, chat_id: str, attachment_id: str) -> bool:
    try:
        ref = _attachment_ref(batch_id, chat_id, attachment_id).collection("chunks")
        while True:
            docs = list(ref.limit(200).stream())
            if not docs:
                return True
            batch = get_firestore().batch()
            for doc in docs:
                batch.delete(doc.reference)
            batch.commit()
    except Exception:
        return False


def update_attachment_chunks_expiry(batch_id: str, chat_id: str, attachment_id: str, expires_at: Any, message_id: str | None = None) -> None:
    docs = list(_attachment_ref(batch_id, chat_id, attachment_id).collection("chunks").limit(200).stream())
    if not docs:
        return
    batch = get_firestore().batch()
    updates = {"expires_at": expires_at, "updated_at": SERVER_TIMESTAMP}
    if message_id is not None:
        updates["message_id"] = message_id
    for doc in docs:
        batch.update(doc.reference, updates)
    batch.commit()


def _image_result(data: dict[str, Any]) -> ExtractionResult:
    text = "\n\n".join(filter(None, [
        str(data.get("file_title") or data.get("file_name") or ""),
        str(data.get("vision_summary") or ""),
        str(data.get("ocr_text") or ""),
    ])).strip()
    return ExtractionResult([ExtractedSegment(text)] if text else [], text, False)


def build_chat_attachment_chunks(
    batch_id: str,
    chat_id: str,
    attachment_id: str,
    lecturer_id: str,
    file_bytes: bytes | None = None,
    force: bool = False,
) -> dict[str, Any]:
    ref = _attachment_ref(batch_id, chat_id, attachment_id)
    snap = ref.get(); data = snap.to_dict() or {}
    if not snap.exists or data.get("batch_id") != batch_id or data.get("chat_id") != chat_id or data.get("lecturer_id") != lecturer_id or data.get("scope") != "chat":
        raise PermissionError("Attachment not found or access denied.")
    if not rag_enabled() and not force:
        ref.update({"rag_status": "skipped", "chunk_status": "skipped", "embedding_status": "skipped", "semantic_search_ready": False, "rag_updated_at": SERVER_TIMESTAMP})
        return {"status": "skipped", "chunk_count": 0}

    ref.update({"rag_status": "pending", "chunk_status": "pending", "rag_error": "", "rag_updated_at": SERVER_TIMESTAMP})
    try:
        kind = str(data.get("attachment_kind") or "document")
        if kind == "image":
            result = _image_result(data); source = "image_vision"
        else:
            if file_bytes is None:
                from utils.gcs import download_bytes
                file_bytes = download_bytes(str(data.get("gcs_path") or ""))
            result = extract_document(file_bytes, str(data.get("content_type") or ""), get_chat_rag_max_extracted_chars())
            source = "native_text"
        chunks, truncated = chunk_extraction(result, target_chars=3500, overlap_chars=750, max_chunks=get_chat_rag_max_chunks())
        if not chunks:
            status = "partial" if kind == "image" else "failed"
            ref.update({"rag_status": status, "chunk_status": "skipped" if kind == "image" else "failed", "embedding_status": "skipped", "semantic_search_ready": False, "chunk_count": 0, "indexed_chars": 0, "rag_error": "No searchable text was available.", "rag_updated_at": SERVER_TIMESTAMP})
            return {"status": status, "chunk_count": 0}

        chunk_ref = ref.collection("chunks")
        old = {doc.id for doc in chunk_ref.limit(200).stream()}
        batch = get_firestore().batch()
        embedding_state = "pending" if embeddings_enabled() else "skipped"
        for index, chunk in enumerate(chunks):
            chunk_id = f"{index:04d}"; old.discard(chunk_id)
            text = chunk.text.strip()
            batch.set(chunk_ref.document(chunk_id), {
                "chunk_id": chunk_id, "batch_id": batch_id, "chat_id": chat_id,
                "lecturer_id": lecturer_id, "attachment_id": attachment_id,
                "message_id": data.get("message_id"), "file_name": data.get("file_name", ""),
                "file_title": data.get("file_title", ""), "content_type": data.get("content_type", ""),
                "attachment_kind": kind, "chunk_index": index, "page_number": chunk.page_number,
                "text": text, "text_hash": hashlib.sha256(text.encode()).hexdigest(),
                "token_estimate": math.ceil(len(text) / 4), "source": source,
                "embedding_status": embedding_state, "embedding_model": "", "embedding_dimensions": 0,
                "expires_at": data.get("expires_at"), "created_at": SERVER_TIMESTAMP, "updated_at": SERVER_TIMESTAMP,
            })
        for stale_id in old:
            batch.delete(chunk_ref.document(stale_id))
        batch.commit()
        rag_status = "partial" if truncated else "ready"
        ref.update({
            "extracted_text_preview": result.text[:MAX_EXTRACTED_PREVIEW_CHARS],
            "parse_status": "ready" if kind == "document" else data.get("parse_status", "skipped"),
            "rag_status": rag_status, "chunk_status": "ready", "embedding_status": embedding_state,
            "semantic_search_ready": False, "chunk_count": len(chunks),
            "indexed_chars": sum(len(chunk.text) for chunk in chunks), "rag_error": "",
            "rag_updated_at": SERVER_TIMESTAMP,
        })
        return {"status": rag_status, "chunk_count": len(chunks), "truncated": truncated}
    except Exception as exc:
        failure = {"rag_status": "failed", "chunk_status": "failed", "embedding_status": "skipped", "semantic_search_ready": False, "rag_error": f"{type(exc).__name__}: {exc}"[:500], "rag_updated_at": SERVER_TIMESTAMP}
        if data.get("attachment_kind") == "document":
            failure["parse_status"] = "failed"
        ref.update(failure)
        return {"status": "failed", "chunk_count": 0}


def embed_chat_attachment_chunks(batch_id: str, chat_id: str, attachment_id: str) -> bool:
    ref = _attachment_ref(batch_id, chat_id, attachment_id)
    if not embeddings_enabled():
        ref.update({"embedding_status": "skipped", "semantic_search_ready": False, "rag_updated_at": SERVER_TIMESTAMP})
        return False


def enrich_chat_attachment(batch_id: str, chat_id: str, attachment_id: str) -> None:
    """Run optional low-text PDF OCR, then optional embeddings."""
    ref = _attachment_ref(batch_id, chat_id, attachment_id)
    snap = ref.get(); data = snap.to_dict() or {}
    if not snap.exists:
        return
    from services.chat_document_ocr import extract_pdf_with_document_ai, ocr_enabled, should_run_ocr
    chunk_docs = list(ref.collection("chunks").order_by("chunk_index").limit(get_chat_rag_max_chunks()).stream())
    native_text = "\n\n".join(str((doc.to_dict() or {}).get("text") or "") for doc in chunk_docs)
    page_numbers = [int((doc.to_dict() or {}).get("page_number") or 0) for doc in chunk_docs]
    needs_ocr = should_run_ocr(str(data.get("content_type") or ""), native_text, max(page_numbers or [0]) or None)
    if not needs_ocr:
        ref.update({"ocr_status": "not_needed", "rag_updated_at": SERVER_TIMESTAMP})
    elif not ocr_enabled():
        ref.update({"ocr_status": "skipped", "rag_updated_at": SERVER_TIMESTAMP})
    else:
        ref.update({"ocr_status": "pending", "rag_updated_at": SERVER_TIMESTAMP})
        try:
            from utils.gcs import download_bytes
            ocr_text = extract_pdf_with_document_ai(download_bytes(str(data.get("gcs_path") or ""))).strip()
            existing_hashes = {str((doc.to_dict() or {}).get("text_hash") or "") for doc in chunk_docs}
            result = ExtractionResult([ExtractedSegment(ocr_text)] if ocr_text else [], ocr_text, False)
            ocr_chunks, _ = chunk_extraction(result, target_chars=3500, overlap_chars=750, max_chunks=max(0, get_chat_rag_max_chunks() - len(chunk_docs)))
            batch = get_firestore().batch(); next_index = len(chunk_docs); added = 0
            for chunk in ocr_chunks:
                text = chunk.text.strip(); digest = hashlib.sha256(text.encode()).hexdigest()
                if not text or digest in existing_hashes:
                    continue
                chunk_id = f"{next_index + added:04d}"; added += 1
                batch.set(ref.collection("chunks").document(chunk_id), {
                    "chunk_id": chunk_id, "batch_id": batch_id, "chat_id": chat_id,
                    "lecturer_id": data.get("lecturer_id"), "attachment_id": attachment_id,
                    "message_id": data.get("message_id"), "file_name": data.get("file_name", ""),
                    "file_title": data.get("file_title", ""), "content_type": data.get("content_type", ""),
                    "attachment_kind": "document", "chunk_index": next_index + added - 1,
                    "page_number": None, "text": text, "text_hash": digest,
                    "token_estimate": math.ceil(len(text) / 4), "source": "document_ai_ocr",
                    "embedding_status": "pending" if embeddings_enabled() else "skipped",
                    "embedding_model": "", "embedding_dimensions": 0,
                    "expires_at": data.get("expires_at"), "created_at": SERVER_TIMESTAMP, "updated_at": SERVER_TIMESTAMP,
                })
            if added:
                batch.commit()
            ref.update({"ocr_status": "ready", "chunk_count": len(chunk_docs) + added, "indexed_chars": int(data.get("indexed_chars") or 0) + sum(len(item.text) for item in ocr_chunks), "rag_status": "ready" if added else data.get("rag_status", "partial"), "embedding_status": "pending" if added and embeddings_enabled() else data.get("embedding_status", "skipped"), "rag_updated_at": SERVER_TIMESTAMP})
        except Exception as exc:
            ref.update({"ocr_status": "failed", "rag_error": f"OCR failed: {type(exc).__name__}"[:500], "rag_updated_at": SERVER_TIMESTAMP})
    if embeddings_enabled():
        embed_chat_attachment_chunks(batch_id, chat_id, attachment_id)


def recover_chat_file_rag(limit: int = 10) -> int:
    """Best-effort recovery for pending enrichment; lexical chunks remain usable."""
    if not rag_enabled():
        return 0
    processed = 0
    for status_field in ("embedding_status", "ocr_status"):
        for doc in get_firestore().collection_group("attachments").where(status_field, "==", "pending").limit(limit).stream():
            data = doc.to_dict() or {}
            if data.get("scope") != "chat":
                continue
            enrich_chat_attachment(str(data.get("batch_id") or ""), str(data.get("chat_id") or ""), doc.id)
            processed += 1
            if processed >= limit:
                return processed
    return processed
    docs = list(ref.collection("chunks").order_by("chunk_index").limit(get_chat_rag_max_chunks()).stream())
    try:
        vectors = embed_texts([(doc.to_dict() or {}).get("text", "") for doc in docs])
        batch = get_firestore().batch(); model = os.getenv("CHAT_FILE_EMBEDDING_MODEL") or "gemini-embedding-001"
        for doc, vector in zip(docs, vectors):
            batch.update(doc.reference, {"embedding": Vector(vector), "embedding_status": "ready", "embedding_model": model, "embedding_dimensions": embedding_dimensions(), "updated_at": SERVER_TIMESTAMP})
        batch.commit()
        ref.update({"embedding_status": "ready", "semantic_search_ready": True, "rag_updated_at": SERVER_TIMESTAMP})
        return True
    except Exception as exc:
        ref.update({"embedding_status": "failed", "semantic_search_ready": False, "rag_error": f"Embedding failed: {type(exc).__name__}"[:500], "rag_updated_at": SERVER_TIMESTAMP})
        return False
