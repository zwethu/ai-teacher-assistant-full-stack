"""Chat attachment MIME types, extensions, and bounded MVP limits."""

DOCUMENT_CONTENT_TYPES = frozenset({
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "text/plain",
    "text/markdown",
    "text/csv",
})
IMAGE_CONTENT_TYPES = frozenset({
    "image/png", "image/jpeg", "image/webp", "image/heic", "image/heif",
})
ALLOWED_CONTENT_TYPES = DOCUMENT_CONTENT_TYPES | IMAGE_CONTENT_TYPES

EXTENSION_CONTENT_TYPES = {
    ".pdf": {"application/pdf"},
    ".docx": {"application/vnd.openxmlformats-officedocument.wordprocessingml.document"},
    ".pptx": {"application/vnd.openxmlformats-officedocument.presentationml.presentation"},
    ".txt": {"text/plain"},
    ".md": {"text/markdown", "text/plain"},
    ".markdown": {"text/markdown", "text/plain"},
    ".csv": {"text/csv", "text/plain", "application/csv"},
    ".png": {"image/png"},
    ".jpg": {"image/jpeg"},
    ".jpeg": {"image/jpeg"},
    ".webp": {"image/webp"},
    ".heic": {"image/heic", "image/heif"},
    ".heif": {"image/heic", "image/heif"},
}

MAX_DOCUMENT_BYTES = 20 * 1024 * 1024
MAX_IMAGE_BYTES = 10 * 1024 * 1024
MAX_ATTACHMENTS_PER_MESSAGE = 5
MAX_IMAGES_PER_MESSAGE = 3
MAX_MESSAGE_ATTACHMENT_BYTES = 30 * 1024 * 1024
MAX_CHAT_ATTACHMENT_BYTES = 100 * 1024 * 1024
MAX_EXTRACTED_PREVIEW_CHARS = 12_000
MAX_AGENT_ATTACHMENT_CONTEXT_CHARS = 30_000
MAX_AGENT_CONTEXT_PER_ATTACHMENT_CHARS = 8_000
ATTACHMENT_RETENTION_DAYS = 30
THUMBNAIL_MAX_SIZE = (768, 768)

NATIVE_MULTIMODAL_ENV = "ENABLE_NATIVE_MULTIMODAL_ATTACHMENTS"

