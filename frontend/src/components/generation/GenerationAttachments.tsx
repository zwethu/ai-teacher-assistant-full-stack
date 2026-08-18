import { useRef, useState, type ChangeEvent, type ReactNode } from 'react'
import { Paperclip } from 'lucide-react'
import type { ChatAttachmentSnapshot } from '../../entity/Chat'
import type { GenerationRunState } from '../../hooks/useGenerationRun'
import {
  AttachmentCard,
  AttachmentViewer,
  attachmentStatusLabel,
} from '../../pages/chat/components/AttachmentPreview'
import { Spinner } from '../../design-system'

/**
 * Optional reference-file attachments for a generation, placed on the request
 * form (not in a chat composer). Files upload to the workflow chat immediately
 * and are attached to the next generate call.
 *
 * Same flow as the chat composer, deliberately: preview-only tiles, tap to open
 * the full viewer, and the identical readiness wording — a lecturer attaching a
 * PDF here should not have to learn a second set of affordances.
 */
export function GenerationAttachments({
  run,
  label = 'Reference files (optional)',
  actions,
}: {
  run: GenerationRunState
  /**
   * Override when the host form has already named this input. Pass `null` to
   * render no label at all — on the Games page the file IS the source the game
   * is built from, so the default wording would call a required input optional.
   */
  label?: string | null
  /**
   * Sibling controls for the Attach row — an alternative way to supply the same
   * input, say. They belong on the button's own line: a host that lays them out
   * beside this whole component instead ends up centring them against the file
   * previews, which grow downward.
   */
  actions?: ReactNode
}) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<ChatAttachmentSnapshot | null>(null)

  async function onFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || [])
    event.target.value = ''
    await run.uploadAttachmentFiles(files)
  }

  const batchId = run.chat?.batch_id
  const chatId = run.chat?.chat_id
  const processing = run.pendingAttachments.some((a) => a.status === 'processing')
  const blocked = run.pendingAttachments.some(
    (a) => a.status === 'too_large' || a.status === 'failed',
  )

  return (
    <div>
      {label && (
        <label className="mb-1.5 block text-sm font-semibold text-slate-700">{label}</label>
      )}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".pdf,.docx,.pptx,.txt,.md,.markdown,.csv,.png,.jpg,.jpeg,.webp,.heic,.heif"
        className="hidden"
        onChange={onFiles}
      />
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={run.attachmentsUploading}
          className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
        >
          {run.attachmentsUploading ? (
            <Spinner size={16} />
          ) : (
            <Paperclip className="h-4 w-4" />
          )}
          Attach files
        </button>
        {actions}
      </div>

      {run.pendingAttachments.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {run.pendingAttachments.map((attachment) => (
            <AttachmentCard
              key={attachment.attachment_id}
              batchId={batchId}
              chatId={chatId}
              attachment={attachment}
              status={attachmentStatusLabel(attachment)}
              onOpen={() => setPreview(attachment)}
              onRemove={() => void run.removePendingAttachment(attachment.attachment_id)}
            />
          ))}
        </div>
      )}

      {processing && (
        <p className="mt-2 text-xs text-slate-500">
          Some files are still processing — you can generate now, and the assistant may note a
          file isn’t ready yet.
        </p>
      )}
      {blocked && (
        <p className="mt-2 text-xs text-amber-600">
          Remove the flagged file to generate. Large files belong in the batch’s course
          materials, where they’re indexed for retrieval.
        </p>
      )}

      {run.attachmentErrors.length > 0 && (
        <div className="mt-2 space-y-1">
          {run.attachmentErrors.map((err, i) => (
            <p key={i} className="text-xs text-red-600">
              {err}
            </p>
          ))}
        </div>
      )}

      {preview && (
        <AttachmentViewer
          batchId={batchId}
          chatId={chatId}
          attachment={preview}
          onClose={() => setPreview(null)}
        />
      )}
    </div>
  )
}
