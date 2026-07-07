import type { AgentInvokePayload } from '../../services/agentService'

export type AttachmentAwareGenerateMode = 'lesson_plan' | 'lab' | 'assessment' | 'course_blueprint'

export function buildGenerationRequest(
  mode: AttachmentAwareGenerateMode,
  batchId: string,
  chatId: string,
  message: string,
  connectors: { web_search: boolean },
  attachmentIds: string[],
): AgentInvokePayload {
  return {
    batch_id: batchId,
    chat_id: chatId,
    workflow_type: `${mode}.generate`,
    workflow_stage: 'outline',
    week: undefined,
    pending_artifact: true,
    save_draft: false,
    message,
    connectors,
    attachment_ids: attachmentIds,
  }
}
