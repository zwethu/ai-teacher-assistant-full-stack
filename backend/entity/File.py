from pydantic import BaseModel

INDEX_STATUS = frozenset({"uploading", "pending", "indexing", "indexed", "failed", "deleting"})


class BatchFile(BaseModel):
    file_id: str
    batch_id: str
    lecturer_id: str
    file_name: str
    file_title: str
    content_type: str
    gcs_path: str
    vertex_doc_id: str = ""
    index_status: str = "uploading"
    index_error: str = ""
    index_message: str = ""
    overlay_status: str = "missing"
    overlay_warning: str = ""
    immediate_ready: bool = False
    durable_index_ready: bool = False
    durable_document_visible: bool = False
    durable_document_visible_at: str | None = None
    overlay_retire_after: str | None = None
    overlay_retired_at: str | None = None
    recovery_lease_owner: str = ""
    recovery_lease_until: str | None = None
    recovery_attempt_count: int = 0
    last_recovery_at: str | None = None
    last_recovery_error: str = ""
    created_at: str | None = None
    updated_at: str | None = None
