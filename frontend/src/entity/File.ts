export type IndexStatus = 'uploading' | 'indexing' | 'indexed' | 'failed' | 'deleting'

export type BatchFile = {
  file_id: string
  batch_id: string
  lecturer_id: string
  file_name: string
  file_title: string
  content_type: string
  gcs_path: string
  vertex_doc_id: string
  index_status: IndexStatus
  index_error: string
  index_message: string
  created_at: string | null
  updated_at: string | null
}
