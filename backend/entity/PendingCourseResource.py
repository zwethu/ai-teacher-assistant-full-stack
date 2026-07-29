from pydantic import BaseModel

class PendingCourseResource(BaseModel):
    resource_id: str
    batch_id: str
    lecturer_id: str
    file_id: str
    file_name: str
    file_title: str
    content_type: str
    gcs_path: str
    status: str = "ready"
    overlay_warning: str = ""
    chunk_count: int = 0
    text_preview: str = ""
    created_at: str | None = None
    updated_at: str | None = None

class PendingCourseResourceChunk(BaseModel):
    chunk_id: str
    batch_id: str
    lecturer_id: str
    resource_id: str
    file_id: str
    chunk_index: int
    text: str
    page_number: int | None = None
    char_count: int
