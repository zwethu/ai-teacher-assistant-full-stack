from typing import Literal

from pydantic import BaseModel


class ChatAttachment(BaseModel):
    attachment_id: str
    batch_id: str
    chat_id: str
    message_id: str | None = None
    lecturer_id: str
    file_name: str
    file_title: str
    content_type: str
    size_bytes: int
    scope: Literal["chat"] = "chat"
    attachment_kind: Literal["document", "image", "other"]
    parse_status: Literal["pending", "ready", "failed", "skipped"] = "pending"
    vision_status: Literal["pending", "ready", "failed", "skipped"] = "skipped"
    extracted_text_preview: str = ""
    vision_summary: str = ""
    ocr_text: str = ""
    vision_error: str = ""
    vision_source: Literal["bytes", "gcs_uri", "none"] = "none"
    expires_at: str | None = None
    promoted_file_id: str | None = None
    promotion_allowed: bool = False
    thumbnail_available: bool = False
    rag_status: Literal["pending", "ready", "partial", "failed", "skipped"] = "skipped"
    chunk_status: Literal["pending", "ready", "failed", "skipped"] = "skipped"
    embedding_status: Literal["pending", "ready", "failed", "skipped"] = "skipped"
    semantic_search_ready: bool = False
    chunk_count: int = 0
    indexed_chars: int = 0
    ocr_status: Literal["not_needed", "pending", "ready", "failed", "skipped"] = "not_needed"
    rag_updated_at: str | None = None
    created_at: str | None = None
    updated_at: str | None = None
