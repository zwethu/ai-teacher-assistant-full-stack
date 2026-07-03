import io
import zipfile

import pytest
from unittest.mock import MagicMock

from services.agent_gateway import build_chat_attachment_context
from services.chat_attachment_service import (
    AttachmentValidationError,
    _agent_safe_attachment,
    _vision_context,
    validate_attachment,
    validate_batch_document,
)
from services.document_extraction import ExtractionResult, ExtractedSegment, chunk_extraction, extract_document
from services.attachment_constants import get_chat_attachment_retention_days
from services.chat_document_ocr import should_run_ocr
from services.chat_vector_search import search_chat_attachment_chunks
from services.chat_file_rag_service import build_chat_attachment_chunks, embed_chat_attachment_chunks


def _ooxml(required: str) -> bytes:
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w") as archive:
        archive.writestr("[Content_Types].xml", "<Types />")
        archive.writestr(required, "<root />")
    return output.getvalue()


def test_validation_accepts_supported_text_and_ooxml() -> None:
    assert validate_attachment("notes.md", "text/plain", b"hello")[1] == "text/markdown"
    assert validate_attachment(
        "lesson.docx",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        _ooxml("word/document.xml"),
    )[1].endswith("wordprocessingml.document")


def test_validation_rejects_signature_and_ooxml_type_mismatch() -> None:
    with pytest.raises(AttachmentValidationError, match="PDF signature"):
        validate_attachment("notes.pdf", "application/pdf", b"not a pdf")
    with pytest.raises(AttachmentValidationError, match="wrong type"):
        validate_attachment(
            "slides.pptx",
            "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            _ooxml("word/document.xml"),
        )


def test_batch_validation_rejects_legacy_doc_and_accepts_json() -> None:
    with pytest.raises(AttachmentValidationError):
        validate_batch_document("legacy.doc", "application/msword", b"doc", 50 * 1024 * 1024)
    assert validate_batch_document("data.json", "application/json", b'{"ok": true}', 50 * 1024 * 1024)[1] == "application/json"


def test_agent_context_is_bounded_and_marks_images_chat_only() -> None:
    records = [{
        "attachment_id": "a1", "file_name": "board.png", "attachment_kind": "image",
        "content_type": "image/png", "vision_summary": "x" * 40_000,
        "ocr_text": "board text", "parse_status": "skipped", "vision_status": "ready",
    }]
    result = build_chat_attachment_context(records)
    context = result["current_chat_attachment_context"]
    assert len(context) <= 30_000
    assert "chat-only" in context
    assert "cannot be promoted" in context
    assert result["current_chat_attachments_manifest"][0]["chat_only"] is True


def test_failed_image_context_explicitly_prevents_guessing() -> None:
    result = build_chat_attachment_context([{
        "attachment_id": "a2", "file_name": "unknown.png", "attachment_kind": "image",
        "content_type": "image/png", "vision_status": "failed",
    }])
    assert "Do not infer image content" in result["current_chat_attachment_context"]


def test_shared_extraction_and_chunking_are_bounded() -> None:
    extracted = extract_document(("paragraph " * 50_000).encode(), "text/plain", 300_000)
    chunks, truncated = chunk_extraction(extracted, max_chunks=3)
    assert len(chunks) == 3
    assert all(len(chunk.text) <= 5000 for chunk in chunks)
    assert truncated is True


def test_vision_uses_bytes_first(monkeypatch) -> None:
    monkeypatch.setenv("ATTACHMENT_VISION_MODEL", "gemini-test")
    monkeypatch.setenv("GOOGLE_CLOUD_PROJECT", "project")
    response = MagicMock(text='{"vision_summary":"board","ocr_text":"week 1"}')
    client = MagicMock(); client.models.generate_content.return_value = response
    monkeypatch.setattr("google.genai.Client", lambda **kwargs: client)
    result = _vision_context(b"image", "gs://bucket/image.png", "image/png")
    assert result[:3] == ("ready", "board", "week 1")
    assert result[4] == "bytes"


def test_vision_falls_back_to_gcs(monkeypatch) -> None:
    monkeypatch.setenv("ATTACHMENT_VISION_MODEL", "gemini-test")
    monkeypatch.setenv("GOOGLE_CLOUD_PROJECT", "project")
    response = MagicMock(text='{"vision_summary":"fallback","ocr_text":""}')
    client = MagicMock(); client.models.generate_content.side_effect = [RuntimeError("bytes failed"), response]
    monkeypatch.setattr("google.genai.Client", lambda **kwargs: client)
    result = _vision_context(b"image", "gs://bucket/image.png", "image/png")
    assert result[0] == "ready" and result[1] == "fallback" and result[4] == "gcs_uri"


def test_same_chat_dto_excludes_storage_and_internal_errors() -> None:
    safe = _agent_safe_attachment("a1", {
        "file_name": "notes.pdf", "content_type": "application/pdf",
        "attachment_kind": "document", "size_bytes": 42,
        "gcs_path": "gs://private/original", "thumbnail_gcs_path": "gs://private/thumb",
        "vision_error": "secret provider failure", "extracted_text_path": "gs://private/text",
        "extracted_text_preview": "bounded context",
    }, include_context=False)
    assert safe["size_bytes"] == 42
    assert "extracted_text_preview" not in safe
    assert not ({"gcs_path", "thumbnail_gcs_path", "extracted_text_path", "vision_error"} & safe.keys())


def test_attachment_search_route_precedes_dynamic_attachment_route() -> None:
    from routers.chats import router

    paths = [route.path for route in router.routes]
    search_index = next(index for index, path in enumerate(paths) if path.endswith("/{chat_id}/attachments/search"))
    dynamic_index = next(index for index, path in enumerate(paths) if path.endswith("/{chat_id}/attachments/{attachment_id}"))
    assert search_index < dynamic_index


def test_chat_attachment_retention_is_configurable_and_clamped(monkeypatch) -> None:
    monkeypatch.delenv("CHAT_ATTACHMENT_RETENTION_DAYS", raising=False)
    assert get_chat_attachment_retention_days() == 7
    monkeypatch.setenv("CHAT_ATTACHMENT_RETENTION_DAYS", "0")
    assert get_chat_attachment_retention_days() == 1
    monkeypatch.setenv("CHAT_ATTACHMENT_RETENTION_DAYS", "99")
    assert get_chat_attachment_retention_days() == 30


def test_chat_rag_chunking_reaches_beyond_preview_limit() -> None:
    text = "first section " * 1000 + " uniquely-retrievable-tail " * 1000
    extracted = extract_document(text.encode(), "text/plain", 500_000)
    chunks, truncated = chunk_extraction(extracted, target_chars=3500, overlap_chars=750, max_chunks=150)
    assert any("uniquely-retrievable-tail" in chunk.text for chunk in chunks)
    assert sum(len(chunk.text) for chunk in chunks) > 12_000
    assert truncated is False


def test_pdf_ocr_gate_is_low_text_only() -> None:
    assert should_run_ocr("application/pdf", "short", page_count=2) is True
    assert should_run_ocr("application/pdf", "x" * 1000, page_count=2) is False
    assert should_run_ocr("text/plain", "", page_count=1) is False


def test_chat_chunk_search_uses_safe_lexical_fallback(monkeypatch) -> None:
    chat_snap = MagicMock(exists=True); chat_snap.to_dict.return_value = {"lecturer_id": "l1"}
    chat_ref = MagicMock(); chat_ref.get.return_value = chat_snap
    attachment_snap = MagicMock(exists=True); attachment_snap.to_dict.return_value = {"lecturer_id": "l1", "scope": "chat"}
    chat_ref.collection.return_value.document.return_value.get.return_value = attachment_snap
    db = MagicMock(); db.collection.return_value.document.return_value.collection.return_value.document.return_value = chat_ref
    query = MagicMock(); query.where.return_value = query; query.limit.return_value = query
    chunk = MagicMock(); chunk.to_dict.return_value = {
        "attachment_id": "a1", "file_name": "long.pdf", "file_title": "Long notes",
        "attachment_kind": "document", "content_type": "application/pdf", "chunk_index": 9,
        "text": "This section explains a uniquely retrievable concept.",
        "gcs_path": "gs://private/path", "embedding": [0.1],
    }
    query.stream.return_value = [chunk]; db.collection_group.return_value = query
    monkeypatch.setenv("CHAT_FILE_EMBEDDINGS_ENABLED", "false")
    monkeypatch.setattr("services.chat_vector_search.get_firestore", lambda: db)
    result = search_chat_attachment_chunks("b1", "c1", "l1", "retrievable concept")
    assert result["status"] == "success"
    assert result["retrieval_mode"] == "lexical"
    assert "gcs_path" not in result["hits"][0]
    assert "embedding" not in result["hits"][0]


def test_chat_rag_builder_writes_bounded_safe_chunks(monkeypatch) -> None:
    attachment = {
        "attachment_id": "a1", "batch_id": "b1", "chat_id": "c1", "lecturer_id": "l1",
        "scope": "chat", "attachment_kind": "document", "content_type": "text/plain",
        "file_name": "long.txt", "file_title": "Long", "expires_at": None,
    }
    snap = MagicMock(exists=True); snap.to_dict.return_value = attachment
    ref = MagicMock(); ref.get.return_value = snap
    chunks = MagicMock(); chunks.limit.return_value.stream.return_value = []
    ref.collection.return_value = chunks
    db = MagicMock(); write_batch = MagicMock(); db.batch.return_value = write_batch
    monkeypatch.setenv("CHAT_FILE_RAG_ENABLED", "true")
    monkeypatch.setenv("CHAT_FILE_RAG_MAX_CHUNKS", "3")
    monkeypatch.setattr("services.chat_file_rag_service._attachment_ref", lambda *_: ref)
    monkeypatch.setattr("services.chat_file_rag_service.get_firestore", lambda: db)
    result = build_chat_attachment_chunks("b1", "c1", "a1", "l1", file_bytes=("searchable content " * 2000).encode())
    assert result["chunk_count"] == 3
    assert write_batch.set.call_count == 3
    for call in write_batch.set.call_args_list:
        payload = call.args[1]
        assert len(payload["text"]) <= 5000
        assert not ({"gcs_path", "bytes", "embedding"} & payload.keys())
    write_batch.commit.assert_called_once()


def test_chat_chunk_embedding_success_filters_empty_chunks(monkeypatch) -> None:
    populated = MagicMock(); populated.to_dict.return_value = {"text": "searchable chunk"}
    empty = MagicMock(); empty.to_dict.return_value = {"text": ""}
    ref = MagicMock()
    ref.collection.return_value.order_by.return_value.limit.return_value.stream.return_value = [populated, empty]
    db = MagicMock(); write_batch = MagicMock(); db.batch.return_value = write_batch
    monkeypatch.setattr("services.chat_file_rag_service._attachment_ref", lambda *_: ref)
    monkeypatch.setattr("services.chat_file_rag_service.get_firestore", lambda: db)
    monkeypatch.setattr("services.chat_file_rag_service.embeddings_enabled", lambda: True)
    embed = MagicMock(return_value=[[0.1, 0.2]])
    monkeypatch.setattr("services.chat_file_rag_service.embed_texts", embed)
    assert embed_chat_attachment_chunks("b1", "c1", "a1") is True
    embed.assert_called_once_with(["searchable chunk"], task_type="RETRIEVAL_DOCUMENT")
    write_batch.update.assert_called_once()
    write_batch.commit.assert_called_once()
    assert ref.update.call_args.args[0]["semantic_search_ready"] is True


def test_chat_chunk_embedding_empty_and_failure_states(monkeypatch) -> None:
    ref = MagicMock()
    ref.collection.return_value.order_by.return_value.limit.return_value.stream.return_value = []
    monkeypatch.setattr("services.chat_file_rag_service._attachment_ref", lambda *_: ref)
    monkeypatch.setattr("services.chat_file_rag_service.embeddings_enabled", lambda: True)
    assert embed_chat_attachment_chunks("b1", "c1", "empty") is False
    assert ref.update.call_args.args[0]["embedding_status"] == "skipped"

    doc = MagicMock(); doc.to_dict.return_value = {"text": "chunk"}
    ref.collection.return_value.order_by.return_value.limit.return_value.stream.return_value = [doc]
    monkeypatch.setattr("services.chat_file_rag_service.embed_texts", MagicMock(side_effect=RuntimeError("provider")))
    assert embed_chat_attachment_chunks("b1", "c1", "failed") is False
    assert ref.update.call_args.args[0]["embedding_status"] == "failed"
    assert ref.update.call_args.args[0]["semantic_search_ready"] is False
