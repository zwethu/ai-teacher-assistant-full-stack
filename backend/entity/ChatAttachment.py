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
    gcs_path: str
    thumbnail_gcs_path: str | None = None
    scope: Literal["chat"] = "chat"
    attachment_kind: Literal["document", "image", "other"]
    parse_status: Literal["pending", "ready", "failed", "skipped"] = "pending"
    vision_status: Literal["pending", "ready", "failed", "skipped"] = "skipped"
    extracted_text_path: str | None = None
    extracted_text_preview: str = ""
    vision_summary: str = ""
    ocr_text: str = ""
    vision_error: str = ""
    vision_source: Literal["bytes", "gcs_uri", "none"] = "none"
    expires_at: str | None = None
    promoted_file_id: str | None = None
    promotion_allowed: bool = False
    thumbnail_available: bool = False
    created_at: str | None = None
    updated_at: str | None = None
