import type { Chat, ChatAttachment, ChatMessage } from '../entity/Chat'
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

export async function createChat(batchId: string, title: string = 'New Chat'): Promise<Chat> {
  const res = await api.post<Chat>(`/batches/${batchId}/chats`, { title })
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

export async function getChatAttachmentContent(
  batchId: string, chatId: string, attachmentId: string, thumbnail = false,
): Promise<Blob> {
  const res = await api.get(
    `/batches/${batchId}/chats/${chatId}/attachments/${attachmentId}/content`,
    { params: { thumbnail }, responseType: 'blob' },
  )
  return res.data as Blob
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
