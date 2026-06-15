from pydantic import BaseModel

INDEX_STATUS = frozenset({"uploading", "indexing", "indexed", "failed", "deleting"})


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
    created_at: str | None = None
    updated_at: str | None = None
