export type IndexStatus = 'uploading' | 'pending' | 'indexing' | 'indexed' | 'failed' | 'deleting'

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
  overlay_status: 'missing' | 'ready' | 'failed' | 'retiring' | 'retired'
  overlay_warning: string
  immediate_ready: boolean
  durable_index_ready: boolean
  durable_document_visible: boolean
  durable_document_visible_at: string | null
  overlay_retire_after: string | null
  overlay_retired_at: string | null
  created_at: string | null
  updated_at: string | null
}
