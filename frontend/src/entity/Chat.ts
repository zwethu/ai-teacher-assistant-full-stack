export type AttachmentKind = 'document' | 'image' | 'other'
export type AttachmentStatus = 'pending' | 'ready' | 'failed' | 'skipped'
export type RagStatus = 'pending' | 'ready' | 'partial' | 'failed' | 'skipped'
export type OcrStatus = 'not_needed' | 'pending' | 'ready' | 'failed' | 'skipped'
// Native-first lifecycle status (single source of truth for readiness).
// too_large: exceeds the per-file native-read ceiling; cannot be sent.
export type AttachmentProcessingStatus = 'processing' | 'ready' | 'failed' | 'too_large'

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
  status: AttachmentProcessingStatus
  token_estimate: number
  parse_status: AttachmentStatus
  vision_status: AttachmentStatus
  thumbnail_available: boolean
  /** PDF page count; 0 for non-PDFs or files that would not parse. */
  page_count?: number
  promotion_allowed: false
}

// Shape returned by the rag-status poll endpoint (native-first fields first).
export type ChatAttachmentStatusUpdate = ChatAttachmentRagState & {
  attachment_id: string
  expires_at: string | null
  status: AttachmentProcessingStatus
  parse_status: AttachmentStatus
  vision_status: AttachmentStatus
  token_estimate: number
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
  /**
   * Set only on a message this browser just sent, and carried across the swap
   * when the backend's copy (with its own `message_id`) replaces the optimistic
   * one. Two things read it:
   *
   *   - it is the React key for the row, so that swap no longer unmounts and
   *     rebuilds the bubble — which used to re-run its entrance and re-probe
   *     every attachment thumbnail mid-flight;
   *   - it is what distinguishes "the lecturer just sent this" from "this came
   *     back from Firestore", so only the former animates in. A message loaded
   *     from history never has one.
   */
  client_id?: string
}

export type Chat = {
  chat_id: string
  batch_id: string
  lecturer_id: string
  title: string
  /** First user message, snapshotted server-side. Absent on chats created before
   *  the field existed — fall back to `title` rather than fetching messages. */
  preview?: string
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
