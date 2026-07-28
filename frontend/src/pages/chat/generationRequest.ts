import type { AgentInvokePayload } from '../../services/agentService'

export type AttachmentAwareGenerateMode =
  | 'lesson_plan'
  | 'lab'
  | 'assessment'
  | 'course_blueprint'
  | 'game'

// Game is single-shot: it has no research/outline/approval stage. It must not send
// workflow_stage 'outline' — the backend checks that branch first, would look for a game
// outline that never exists, and the run would end in outline_extract.failed instead of
// staging the game. Sending '' with pending_artifact routes it to the pending-artifact
// branch, which is where the game is staged.
const SINGLE_SHOT_MODES = new Set<AttachmentAwareGenerateMode>(['game'])

export function buildGenerationRequest(
  mode: AttachmentAwareGenerateMode,
  batchId: string,
  chatId: string,
  message: string,
  connectors: { web_search: boolean },
  attachmentIds: string[],
): AgentInvokePayload {
  const singleShot = SINGLE_SHOT_MODES.has(mode)
  return {
    batch_id: batchId,
    chat_id: chatId,
    workflow_type: `${mode}.generate`,
    workflow_stage: singleShot ? '' : 'outline',
    week: undefined,
    pending_artifact: true,
    save_draft: false,
    message,
    // A game is built only from the attached PDF, so web search is forced off — the
    // agent is told never to use it and the connector default is `true`.
    connectors: singleShot ? { ...connectors, web_search: false } : connectors,
    attachment_ids: attachmentIds,
  }
}
