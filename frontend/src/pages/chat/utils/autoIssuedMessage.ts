import type { ChatMessage } from '../../../entity/Chat'

/**
 * Metadata the backend stamps on a request a control issued on the lecturer's
 * behalf. See `add_user_message_with_attachments` — only `approve_outline`
 * carries it, because that action has no path other than the approval button.
 */
export const AUTO_ISSUED_METADATA = { auto_generated: true } as const

/**
 * Wording the approval button sends. Kept as a prefix check because the label
 * varies by workflow ("...the full lab preview.", "...the full course blueprint
 * preview.", and the generation page's unqualified "...the full preview.").
 */
export function isGeneratedOutlineApprovalText(content: string) {
  return content.trim().toLowerCase().startsWith('approve this outline and generate the full ')
}

/**
 * True for a user message the UI composed, not one the lecturer wrote.
 *
 * Pressing "Approve and generate full preview" has to send *something* — the
 * agent needs a turn to answer — but showing that sentence back as if it were
 * typed misreports what happened: the lecturer pressed a button, and the card
 * they pressed it on already says so. So the turn still exists, and only its
 * question is hidden.
 *
 * The metadata flag is the durable half and the authority. The text check is
 * the fallback for chats written before the flag existed; it is a prefix match
 * on a sentence this app generates, so a lecturer who happens to type it
 * verbatim in an old chat would have it swallowed — accepted, since there is no
 * other signal to separate the two after the fact.
 */
export function isAutoIssuedUserMessage(msg: ChatMessage) {
  if (msg.role !== 'user') return false
  if (msg.metadata?.auto_generated === true) return true
  return isGeneratedOutlineApprovalText(msg.content)
}
