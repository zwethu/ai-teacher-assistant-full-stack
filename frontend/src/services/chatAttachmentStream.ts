import { child, onChildAdded, onChildChanged, ref } from 'firebase/database'
import type { ChatAttachmentStatusUpdate } from '../entity/Chat'
import { rtdb } from '../lib/firebase'

/**
 * Live attachment readiness.
 *
 * Uploads are processed asynchronously (extract / OCR / vision) and the composer
 * has to know when a file becomes usable. That used to be discovered by polling
 * `/attachments/{id}/rag-status` every 2.5s per in-flight file, one Firestore read
 * per request per file.
 *
 * The backend now mirrors each status transition to RTDB, so the browser can be
 * told instead of asking. The mirror is best-effort by design — if RTDB is not
 * configured, or the rule/websocket is unavailable, `onUnavailable` fires and the
 * caller keeps polling exactly as before. Firestore stays the source of truth.
 *
 * Shape mirrors agentRuns, which is the only ownership model the RTDB rules
 * support: `chatAttachments/{chat_id}/meta/lecturer_id` is written by the Admin
 * SDK and read back by the rule.
 */

export type ChatAttachmentStatusEvent = Partial<ChatAttachmentStatusUpdate> & {
  attachment_id: string
}

export type ChatAttachmentStreamOptions = {
  onStatus: (update: ChatAttachmentStatusEvent) => void
  /** The live channel cannot be used — fall back to polling. */
  onUnavailable?: (error: unknown) => void
}

function normalize(raw: unknown): ChatAttachmentStatusEvent | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Record<string, unknown>
  const attachmentId = value.attachment_id
  if (typeof attachmentId !== 'string' || !attachmentId) return null
  return { ...(value as ChatAttachmentStatusEvent), attachment_id: attachmentId }
}

export function subscribeChatAttachments(
  chatId: string,
  options: ChatAttachmentStreamOptions,
): () => void {
  try {
    const itemsRef = child(ref(rtdb, `chatAttachments/${chatId}`), 'items')

    const handleError = (error: unknown) => {
      console.error(error)
      options.onUnavailable?.(error)
    }
    const emit = (raw: unknown) => {
      const update = normalize(raw)
      if (update) options.onStatus(update)
    }

    // Added covers attachments already mirrored when the listener attaches;
    // changed covers each transition after that.
    const unsubscribers = [
      onChildAdded(itemsRef, (snapshot) => emit(snapshot.val()), handleError),
      onChildChanged(itemsRef, (snapshot) => emit(snapshot.val()), handleError),
    ]
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe())
  } catch (error) {
    handleSubscribeFailure(error, options)
    return () => undefined
  }
}

function handleSubscribeFailure(error: unknown, options: ChatAttachmentStreamOptions) {
  console.error(error)
  options.onUnavailable?.(error)
}
