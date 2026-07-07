import { useRef, type ChangeEvent } from 'react'
import { Loader2, Paperclip, X } from 'lucide-react'
import type { GenerationRunState } from '../../hooks/useGenerationRun'

/**
 * Optional reference-file attachments for a generation, placed on the request
 * form (not in a chat composer). Files upload to the workflow chat immediately
 * and are attached to the next generate call.
 */
export function GenerationAttachments({ run }: { run: GenerationRunState }) {
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function onFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || [])
    event.target.value = ''
    await run.uploadAttachmentFiles(files)
  }

  return (
    <div>
      <label className="mb-1.5 block text-sm font-semibold text-slate-700">
        Reference files (optional)
      </label>
      <input ref={fileInputRef} type="file" multiple className="hidden" onChange={onFiles} />
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        disabled={run.attachmentsUploading}
        className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
      >
        {run.attachmentsUploading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Paperclip className="h-4 w-4" />
        )}
        Attach files
      </button>

      {run.pendingAttachments.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {run.pendingAttachments.map((a) => (
            <span
              key={a.attachment_id}
              className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-700"
            >
              {a.file_name}
              {a.status === 'processing' && <Loader2 className="h-3 w-3 animate-spin" />}
              <button
                type="button"
                onClick={() => void run.removePendingAttachment(a.attachment_id)}
                className="ml-1 text-slate-400 hover:text-slate-600"
                aria-label={`Remove ${a.file_name}`}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
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
    </div>
  )
}
