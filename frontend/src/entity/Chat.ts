export type AttachmentKind = 'document' | 'image' | 'other'
export type AttachmentStatus = 'pending' | 'ready' | 'failed' | 'skipped'
export type RagStatus = 'pending' | 'ready' | 'partial' | 'failed' | 'skipped'
export type OcrStatus = 'not_needed' | 'pending' | 'ready' | 'failed' | 'skipped'

export type ChatAttachmentRagState = {
  rag_status: RagStatus
  chunk_status: AttachmentStatus
  embedding_status: AttachmentStatus
  semantic_search_ready: boolean
  chunk_count: number
  indexed_chars: number
  ocr_status: OcrStatus
  rag_updated_at: string | null
}

export type ChatAttachmentSnapshot = {
  attachment_id: string
  file_name: string
  file_title: string
  content_type: string
  size_bytes: number
  attachment_kind: AttachmentKind
  parse_status: AttachmentStatus
  vision_status: AttachmentStatus
  thumbnail_available: boolean
  promotion_allowed: false
}

export type ChatAttachment = ChatAttachmentSnapshot & ChatAttachmentRagState & {
  batch_id: string
  chat_id: string
  message_id: string | null
  lecturer_id: string
  scope: 'chat'
  extracted_text_preview: string
  vision_summary: string
  ocr_text: string
  vision_error?: string
  vision_source?: 'bytes' | 'gcs_uri' | 'none'
  expires_at: string | null
  promoted_file_id: null
  created_at: string | null
  updated_at: string | null
}

export type ChatAttachmentListItem = Omit<ChatAttachmentSnapshot, 'promotion_allowed'> & ChatAttachmentRagState & {
  message_id: string
  vision_source: 'bytes' | 'gcs_uri' | 'none'
  extracted_text_preview?: string
  vision_summary?: string
  ocr_text?: string
  created_at: string | null
  expires_at: string | null
}

export type ChatMessage = {
  message_id: string
  chat_id: string
  role: 'user' | 'assistant'
  content: string
  created_at: string | null
  status?: 'pending' | 'done' | 'failed'
  run_id?: string
  pending?: boolean
  metadata?: Record<string, unknown>
  attachments?: ChatAttachmentSnapshot[]
}

export type Chat = {
  chat_id: string
  batch_id: string
  lecturer_id: string
  title: string
  agent_session_id?: string
  agent_user_id?: string
  active_run_id?: string
  last_run_id?: string
  last_run_status?: string
  agent_engine_resource_name?: string
  type?: 'chat' | 'workflow'
  workflow_type?: string
  week?: number | null
  hidden?: boolean
  created_at: string | null
  updated_at: string | null
}
