import type { ChatMessage } from '../../../entity/Chat'
import { isOutlineApprovalMessage } from '../components/MessageRow'
import { isAutoIssuedUserMessage } from './autoIssuedMessage'

/**
 * The outline a typed reply should refine, if any.
 *
 * The outline card says "Reply with changes to revise the outline" — so a
 * reply while an outline is awaiting approval is an edit request for THAT
 * outline, and must run as `approval_action=refine_outline` (one formatter
 * call reusing the existing research), never as a fresh workflow request.
 * Sending it plain restarted the whole pipeline: begin → research → searches
 * → web → outline, ~90s of work to change one field.
 *
 * Walking backwards: the first real (non-auto-issued) user message means the
 * outline was already superseded by an earlier follow-up; the first
 * approvable outline before that is the refine target — unless some message
 * already carries its run id as `approved_outline_run_id`, i.e. it was
 * approved and generation ran.
 */
export function findRefinableOutline(messages: ChatMessage[]): ChatMessage | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.role === 'user' && !isAutoIssuedUserMessage(msg)) return null
    if (!isOutlineApprovalMessage(msg, Boolean(msg.pending))) continue
    if (!msg.run_id) return null
    const approved = messages.some(
      (m) => String(m.metadata?.approved_outline_run_id || '') === msg.run_id,
    )
    return approved ? null : msg
  }
  return null
}

/** Generate mode for an outline message's artifact type ('' when unknown). */
export function refineModeForOutline(msg: ChatMessage): string {
  const type = String(msg.metadata?.outline_artifact_type || msg.metadata?.artifact_type || '')
  if (type === 'quiz') return 'assessment'
  return ['lesson_plan', 'lab', 'course_blueprint'].includes(type) ? type : ''
}
