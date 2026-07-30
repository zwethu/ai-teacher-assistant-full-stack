import type { Chat, ChatAttachment, ChatAttachmentListItem, ChatAttachmentStatusUpdate, ChatMessage } from '../entity/Chat'
import api from '../lib/api'
import type { LessonPlanExportResult } from './artifactService'
import type { AgentRunEvent, AgentRunStatus, AgentRunStep } from './agentRunStream'

export type ChatRunRecord = {
  run_id: string
  status: AgentRunStatus
  error?: string
  timeline_snapshot?: {
    events?: AgentRunEvent[]
    steps?: Record<string, AgentRunStep>
    status?: AgentRunStatus
    captured_at?: number
  }
}

// ---------------------------------------------------------------------------
// Chat CRUD
// ---------------------------------------------------------------------------

export async function createChat(
  batchId: string,
  title: string = 'New Chat',
  options?: { type?: 'chat' | 'workflow'; workflowType?: string; hidden?: boolean },
): Promise<Chat> {
  const res = await api.post<Chat>(`/batches/${batchId}/chats`, {
    title,
    type: options?.type,
    workflow_type: options?.workflowType,
    hidden: options?.hidden,
  })
  return res.data
}

export async function listChats(batchId: string): Promise<Chat[]> {
  const res = await api.get<Chat[]>(`/batches/${batchId}/chats`)
  return res.data
}

export async function getChat(batchId: string, chatId: string): Promise<Chat> {
  const res = await api.get<Chat>(`/batches/${batchId}/chats/${chatId}`)
  return res.data
}

export async function deleteChat(batchId: string, chatId: string): Promise<void> {
  await api.delete(`/batches/${batchId}/chats/${chatId}`)
}

export async function updateChatTitle(
  batchId: string,
  chatId: string,
  title: string,
): Promise<void> {
  await api.patch(`/batches/${batchId}/chats/${chatId}/title`, { title })
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export async function listMessages(batchId: string, chatId: string): Promise<ChatMessage[]> {
  const res = await api.get<ChatMessage[]>(`/batches/${batchId}/chats/${chatId}/messages`)
  return res.data
}

export async function getChatRun(
  batchId: string,
  chatId: string,
  runId: string,
): Promise<ChatRunRecord> {
  const res = await api.get<ChatRunRecord>(`/batches/${batchId}/chats/${chatId}/runs/${runId}`)
  return res.data
}

export async function sendMessage(
  batchId: string,
  chatId: string,
  content: string,
  connectors: Record<string, boolean> = {},
  attachmentIds: string[] = [],
): Promise<{
  user_message: ChatMessage
  run_id: string
  rtdb_run_path: string
  status: 'running' | 'done' | 'failed'
}> {
  const res = await api.post<{
    user_message: ChatMessage
    run_id: string
    rtdb_run_path: string
    status: 'running' | 'done' | 'failed'
  }>(`/batches/${batchId}/chats/${chatId}/messages`, {
    content, connectors, attachment_ids: attachmentIds,
  })
  return res.data
}

export async function uploadChatAttachment(
  batchId: string, chatId: string, file: File,
): Promise<ChatAttachment> {
  const form = new FormData()
  form.append('file', file)
  form.append('file_title', file.name)
  const res = await api.post<ChatAttachment>(
    `/batches/${batchId}/chats/${chatId}/attachments`, form,
  )
  return res.data
}

export type ChatExportFormat = 'markdown' | 'pdf' | 'docx'

/** Human label for each format, for menus and error messages. */
export const EXPORT_FORMAT_LABELS: Record<ChatExportFormat, string> = {
  pdf: 'PDF',
  markdown: 'Markdown',
  docx: 'DOCX',
}

/** Pull the server's filename out of Content-Disposition, else fall back. */
function filenameFrom(headerValue: unknown, fallback: string): string {
  if (typeof headerValue !== 'string') return fallback
  const match = /filename\*?=(?:UTF-8''|")?([^";]+)/i.exec(headerValue)
  return match ? decodeURIComponent(match[1].replace(/"$/, '')) : fallback
}

/** Hand a blob to the browser as a download, then release the object URL. */
function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  // revoke on the next tick — Safari cancels an in-flight download otherwise
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

/** Download the whole conversation. */
export async function exportChat(
  batchId: string, chatId: string, format: ChatExportFormat,
): Promise<void> {
  const res = await api.get(`/batches/${batchId}/chats/${chatId}/export`, {
    params: { format }, responseType: 'blob',
  })
  saveBlob(res.data as Blob, filenameFrom(res.headers?.['content-disposition'], `chat.${format}`))
}

/** Download a single response. */
export async function exportMessage(
  batchId: string, chatId: string, messageId: string, format: ChatExportFormat,
): Promise<void> {
  const res = await api.get(
    `/batches/${batchId}/chats/${chatId}/messages/${messageId}/export`,
    { params: { format }, responseType: 'blob' },
  )
  saveBlob(res.data as Blob, filenameFrom(res.headers?.['content-disposition'], `response.${format}`))
}

/** Remove one message. Used by retry to drop the superseded response. */
export async function deleteMessage(
  batchId: string, chatId: string, messageId: string,
): Promise<void> {
  await api.delete(`/batches/${batchId}/chats/${chatId}/messages/${messageId}`)
}

/**
 * Stop a run. The server flags it, notices between streamed chunks, and closes
 * the Agent Engine stream — so generation actually halts rather than finishing
 * unseen. Anything already streamed is discarded. `cancelled` comes back false
 * when the run had already finished.
 */
export async function cancelChatRun(
  batchId: string, chatId: string, runId: string,
): Promise<boolean> {
  const res = await api.post<{ cancelled?: boolean }>(
    `/batches/${batchId}/chats/${chatId}/runs/${runId}/cancel`,
  )
  return Boolean(res.data?.cancelled)
}

export async function getChatAttachmentContent(
  batchId: string, chatId: string, attachmentId: string, thumbnail = false,
): Promise<Blob> {
  const res = await api.get(
    `/batches/${batchId}/chats/${chatId}/attachments/${attachmentId}/content`,
    { params: { thumbnail }, responseType: 'blob' },
  )
  return res.data as Blob
}

export async function deleteChatAttachment(batchId: string, chatId: string, attachmentId: string): Promise<void> {
  await api.delete(`/batches/${batchId}/chats/${chatId}/attachments/${attachmentId}`)
}

export async function listChatAttachments(batchId: string, chatId: string, limit = 50): Promise<ChatAttachmentListItem[]> {
  const res = await api.get<ChatAttachmentListItem[]>(`/batches/${batchId}/chats/${chatId}/attachments`, { params: { limit } })
  return res.data
}

export async function getChatAttachmentRagStatus(batchId: string, chatId: string, attachmentId: string): Promise<ChatAttachmentStatusUpdate> {
  const res = await api.get<ChatAttachmentStatusUpdate>(`/batches/${batchId}/chats/${chatId}/attachments/${attachmentId}/rag-status`)
  return res.data
}

export async function generateDocsFromPendingArtifact(
  batchId: string,
  chatId: string,
  runId: string,
): Promise<LessonPlanExportResult & { pending_artifact_id?: string; artifact_type?: string }> {
  const res = await api.post<LessonPlanExportResult & { pending_artifact_id?: string; artifact_type?: string }>(
    `/batches/${batchId}/chats/${chatId}/runs/${runId}/pending-artifact/generate-docs`,
  )
  return res.data
}

export async function exportPendingQuizToGoogleForms(
  batchId: string,
  chatId: string,
  runId: string,
): Promise<LessonPlanExportResult & { artifact_type?: string }> {
  const res = await api.post<LessonPlanExportResult & { artifact_type?: string }>(
    `/batches/${batchId}/chats/${chatId}/runs/${runId}/pending-artifact/export-google-form`,
  )
  return res.data
}

export interface SendPendingEmailResult {
  success?: boolean
  sent_count: number
  failed_count: number
  recipients: string[]
  failed: { to: string; error: string }[]
}

export async function sendPendingEmail(
  batchId: string,
  chatId: string,
  runId: string,
): Promise<SendPendingEmailResult> {
  const res = await api.post<SendPendingEmailResult>(
    `/batches/${batchId}/chats/${chatId}/runs/${runId}/pending-artifact/send-email`,
  )
  return res.data
}

export interface SchedulePendingEmailResult {
  success?: boolean
  email_id: string
  recipient_count: number
  send_at: string
}

export async function schedulePendingEmail(
  batchId: string,
  chatId: string,
  runId: string,
  sendAtIso: string,
): Promise<SchedulePendingEmailResult> {
  const res = await api.post<SchedulePendingEmailResult>(
    `/batches/${batchId}/chats/${chatId}/runs/${runId}/pending-artifact/schedule-email`,
    { send_at: sendAtIso },
  )
  return res.data
}

export interface UpdatePendingEmailResult {
  success: boolean
  subject: string
  body: string
  recipients: string[]
  recipient_count: number
  preview_markdown: string
}

/** Edit a staged email before sending. Only valid until it is sent or scheduled. */
export async function updatePendingEmail(
  batchId: string,
  chatId: string,
  runId: string,
  payload: { subject: string; body: string; recipients?: string[] },
): Promise<UpdatePendingEmailResult> {
  const res = await api.patch<UpdatePendingEmailResult>(
    `/batches/${batchId}/chats/${chatId}/runs/${runId}/pending-artifact/email`,
    payload,
  )
  return res.data
}
