import type { ChatMessage } from '../../entity/Chat'
import type { RunUiState } from '../../pages/chat/runTypes'
import type { GenerationRunState } from '../../hooks/useGenerationRun'
import {
  isGeneratedArtifactPreviewMessage,
  isOutlineApprovalMessage,
} from '../../pages/chat/components/MessageRow'

// A single generation run, presented as a workflow rather than a chat transcript.
export type GenerationStage =
  | 'idle'
  | 'generating_outline'
  | 'generating_full'
  | 'outline_review'
  | 'preview'
  | 'done'
  | 'failed'
  | 'cancelled'

export type DerivedStage = {
  stage: GenerationStage
  activeMessage: ChatMessage | null
  runState: RunUiState | undefined
}

/**
 * Collapse the run's message list + run state into the one workflow stage the
 * UI should show. We follow the message tied to the current run (the one the
 * user is actively driving), never the whole conversation — so there is no
 * transcript and no chat feel.
 */
export function deriveGenerationStage(run: GenerationRunState): DerivedStage {
  const { messages, runStates, currentRunId, activePhase } = run
  if (messages.length === 0) {
    return { stage: 'idle', activeMessage: null, runState: undefined }
  }

  const reversed = [...messages].reverse()
  const active =
    (currentRunId
      ? reversed.find((m) => m.role === 'assistant' && m.run_id === currentRunId)
      : undefined) ??
    reversed.find((m) => m.role === 'assistant') ??
    null

  const runState = active?.run_id ? runStates[active.run_id] : undefined

  if (!active) {
    // No assistant slot: mid-kickoff while a phase is armed, otherwise nothing
    // is running (e.g. the run was stopped before it produced a placeholder).
    if (!activePhase) return { stage: 'idle', activeMessage: null, runState }
    return {
      stage: activePhase === 'full' ? 'generating_full' : 'generating_outline',
      activeMessage: null,
      runState,
    }
  }

  const status = runState?.status
  if (status === 'cancelled') {
    return { stage: 'cancelled', activeMessage: active, runState }
  }
  if (active.status === 'failed' || status === 'failed') {
    return { stage: 'failed', activeMessage: active, runState }
  }

  const isPending = Boolean(active.pending || active.status === 'pending')
  if (isPending || status === 'running' || status === 'awaiting_attachments') {
    // 'refine' (a plain follow-up run) reads as outline work in progress; only a
    // real Phase-B run shows the full-generation label.
    return {
      stage: activePhase === 'full' ? 'generating_full' : 'generating_outline',
      activeMessage: active,
      runState,
    }
  }

  const metadata = active.metadata || {}
  if (isOutlineApprovalMessage(active, false) && metadata.outline_approval_status !== 'approved') {
    return { stage: 'outline_review', activeMessage: active, runState }
  }

  if (isGeneratedArtifactPreviewMessage(active, false)) {
    // Each workflow ends by stamping its result onto the message. Docs and Forms
    // exports leave a link; saving a game or a course plan leaves an id, so those
    // count as delivered too or their runs could never finish.
    const delivered = Boolean(
      metadata.doc_url ||
        metadata.form_url ||
        metadata.export_result ||
        metadata.lecturer_doc_url ||
        metadata.student_doc_url ||
        metadata.game_id ||
        metadata.course_blueprint_saved_id,
    )
    return { stage: delivered ? 'done' : 'preview', activeMessage: active, runState }
  }

  // Generic assistant result (e.g. a consulting reply) — treat as a preview.
  return { stage: 'preview', activeMessage: active, runState }
}
