import { useRef, useState, type ChangeEvent, type KeyboardEvent, type ReactNode } from 'react'
import { Loader2, Paperclip, Send, X } from 'lucide-react'
import type { Batch } from '../../entity/Batch'
import { MessageRow } from '../../pages/chat/components/MessageRow'
import type { GenerationRunState } from '../../hooks/useGenerationRun'

/**
 * Shared stream + HITL + composer surface for standalone generation pages.
 * The page owns the structured form and calls run.generate(...); this component
 * renders the live run (streaming text, thinking/steps, outline-approval and
 * artifact-preview cards via MessageRow) plus a composer for retry-with-edits and
 * follow-up instructions, and an optional attachment tray.
 */
export function GenerationWorkspace({
  batch,
  run,
  emptyHint,
}: {
  batch: Batch
  run: GenerationRunState
  emptyHint?: ReactNode
}) {
  const [text, setText] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const hasRun = run.messages.length > 0

  async function onFiles(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || [])
    e.target.value = ''
    await run.uploadAttachmentFiles(files)
  }

  async function submitFollowUp() {
    const value = text.trim()
    if (!value || run.sending) return
    setText('')
    await run.sendFollowUp(value)
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void submitFollowUp()
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto px-1 py-2">
        {!hasRun ? (
          <div className="flex h-full items-center justify-center text-center text-sm text-gray-500">
            {emptyHint ?? 'Fill in the form and click Generate to start.'}
          </div>
        ) : (
          <div className="space-y-4">
            {run.messages.map((msg) => {
              const metadata = msg.metadata || {}
              return (
                <MessageRow
                  key={msg.message_id}
                  msg={msg}
                  run={msg.run_id ? run.runStates[msg.run_id] : undefined}
                  batchId={batch.id}
                  courseName={batch.course_name}
                  onApproveOutline={run.approveOutline}
                  approvalDisabled={run.sending}
                  approvalCompleted={metadata.outline_approval_status === 'approved'}
                  approvalSuperseded={metadata.outline_approval_status === 'superseded'}
                />
              )
            })}
          </div>
        )}
      </div>

      {hasRun && (
        <div className="border-t border-gray-200 px-1 pt-3">
          {run.pendingAttachments.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2">
              {run.pendingAttachments.map((a) => (
                <span
                  key={a.attachment_id}
                  className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-700"
                >
                  {a.file_name}
                  {a.status === 'processing' && <Loader2 className="h-3 w-3 animate-spin" />}
                  <button
                    type="button"
                    onClick={() => void run.removePendingAttachment(a.attachment_id)}
                    className="ml-1 text-gray-400 hover:text-gray-600"
                    aria-label={`Remove ${a.file_name}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
          {run.attachmentErrors.length > 0 && (
            <div className="mb-2 space-y-1">
              {run.attachmentErrors.map((err, i) => (
                <p key={i} className="text-xs text-red-600">{err}</p>
              ))}
            </div>
          )}
          <div className="flex items-end gap-2 pb-2">
            <input ref={fileInputRef} type="file" multiple className="hidden" onChange={onFiles} />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={run.attachmentsUploading}
              className="rounded-lg border border-gray-300 p-2 text-gray-500 hover:bg-gray-50 disabled:opacity-50"
              aria-label="Attach files"
            >
              {run.attachmentsUploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Paperclip className="h-5 w-5" />}
            </button>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={onKeyDown}
              rows={1}
              placeholder="Refine with instructions, or ask to retry the outline…"
              className="max-h-40 flex-1 resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
              disabled={run.sending}
            />
            <button
              type="button"
              onClick={() => void submitFollowUp()}
              disabled={run.sending || !text.trim()}
              className="rounded-lg bg-indigo-600 p-2 text-white hover:bg-indigo-700 disabled:opacity-50"
              aria-label="Send"
            >
              {run.sending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
