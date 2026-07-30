import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Download, FileCode, FileText, Image as ImageIcon, Paperclip, X } from 'lucide-react'
import type { ChatAttachmentSnapshot } from '../../../entity/Chat'
import { getChatAttachmentContent } from '../../../services/chatService'
import { Spinner } from '../../../design-system'

/**
 * Attachment previews and the viewer they open.
 *
 * Attachments are kept for a bounded window (CHAT_ATTACHMENT_RETENTION_DAYS,
 * 30 days) and the copy stored on a message is a frozen snapshot — it keeps
 * saying `thumbnail_available` long after the bytes are gone. Availability is
 * therefore discovered by trying to load, never by trusting the snapshot, which
 * also covers deletion rather than only expiry.
 */

export type PreviewKind = 'image' | 'text' | 'pdf' | 'other'

/**
 * Anything with enough shape to preview. `ChatAttachmentSnapshot` (on a message)
 * and `ChatAttachmentListItem` (in the resources panel) differ only by
 * `promotion_allowed`, which nothing here reads.
 */
export type PreviewableAttachment = Omit<ChatAttachmentSnapshot, 'promotion_allowed'> & {
  promotion_allowed?: false
}

const TEXT_EXTENSIONS = /\.(md|markdown|txt|csv|json|ya?ml|log)$/i

export function previewKind(attachment: PreviewableAttachment): PreviewKind {
  if (attachment.attachment_kind === 'image') return 'image'
  if (attachment.content_type === 'application/pdf') return 'pdf'
  if (attachment.content_type.startsWith('text/') || TEXT_EXTENSIONS.test(attachment.file_name)) {
    return 'text'
  }
  return 'other'
}

const IMAGE_EXTENSIONS = /\.(png|jpe?g|webp|heic|heif|gif|bmp)$/i

/**
 * Build a previewable attachment from a re-reference, which carries only an id
 * and a filename.
 *
 * A referenced file is the same file — it should look and open exactly like a
 * freshly attached one on the sent message, not degrade to a name chip. The
 * kind is inferred from the extension, which is all `previewKind` needs; the
 * bytes are fetched by id like any other attachment.
 */
export function attachmentFromReference(id: string, title: string): PreviewableAttachment {
  const isImage = IMAGE_EXTENSIONS.test(title)
  const isPdf = /\.pdf$/i.test(title)
  return {
    attachment_id: id,
    file_name: title,
    file_title: title,
    content_type: isImage
      ? `image/${(title.split('.').pop() || 'png').toLowerCase().replace('jpg', 'jpeg')}`
      : isPdf
        ? 'application/pdf'
        : 'text/plain',
    size_bytes: 0,
    attachment_kind: isImage ? 'image' : 'document',
    status: 'ready',
    token_estimate: 0,
    parse_status: 'skipped',
    vision_status: 'skipped',
    thumbnail_available: isImage || isPdf,
  }
}

export function formatBytes(bytes: number): string {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/**
 * Human readiness label. Now that the tiles are preview-only this is a tooltip
 * rather than a caption, but it is still the one wording shared by the chat
 * composer and the standalone generation forms.
 */
export function attachmentStatusLabel(
  attachment: PreviewableAttachment & { vision_status?: string },
): string {
  if (attachment.status === 'too_large') return 'too large — add to Course Space'
  if (attachment.status === 'processing') return 'processing…'
  if (attachment.status === 'failed') return 'processing failed'
  if (attachment.attachment_kind === 'image') {
    return `chat-only · ${attachment.vision_status === 'ready' ? 'vision ready' : 'ready'}`
  }
  return 'ready'
}

function KindIcon({ kind, className = 'h-4 w-4' }: { kind: PreviewKind; className?: string }) {
  if (kind === 'image') return <ImageIcon className={`${className} text-violet-600`} />
  if (kind === 'pdf') return <FileText className={`${className} text-violet-600`} />
  if (kind === 'text') return <FileCode className={`${className} text-violet-600`} />
  return <Paperclip className={`${className} text-slate-500`} />
}

/** Short uppercase badge, as in the composer cards. */
function formatBadge(attachment: PreviewableAttachment): string {
  const ext = attachment.file_name.split('.').pop() || ''
  return ext.slice(0, 4).toUpperCase()
}

/**
 * Loads an attachment's thumbnail (or full bytes) and reports unavailability.
 *
 * `enabled` keeps the fetch from firing for attachments that have no preview
 * worth loading.
 */
function useAttachmentBlobUrl(
  batchId: string | undefined,
  chatId: string | undefined,
  attachmentId: string,
  enabled: boolean,
  thumbnail: boolean,
  /** Re-fetch when this changes — thumbnails appear only after processing. */
  revision: string = '',
  /** Retry with the full file when the thumbnail is not there yet. */
  fallbackToFull = false,
): { url: string; loading: boolean; unavailable: boolean } {
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [unavailable, setUnavailable] = useState(false)

  useEffect(() => {
    if (!enabled || !batchId || !chatId || !attachmentId) return undefined
    let cancelled = false
    let objectUrl = ''
    setLoading(true)
    setUnavailable(false)

    async function load() {
      try {
        let blob: Blob
        try {
          blob = await getChatAttachmentContent(batchId!, chatId!, attachmentId, thumbnail)
        } catch (err) {
          // A just-uploaded file has no thumbnail yet — it is rendered during
          // processing. For images the original bytes are a perfectly good
          // preview, so use those rather than showing a placeholder.
          if (!thumbnail || !fallbackToFull) throw err
          blob = await getChatAttachmentContent(batchId!, chatId!, attachmentId, false)
        }
        if (cancelled) return
        objectUrl = URL.createObjectURL(blob)
        setUrl(objectUrl)
      } catch {
        // Gone: past the retention window, or deleted.
        if (!cancelled) setUnavailable(true)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()

    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [batchId, chatId, attachmentId, enabled, thumbnail, revision, fallbackToFull])

  return { url, loading, unavailable }
}

/** Square thumbnail for an image attachment; falls back to its icon. */
export function AttachmentThumbnail({
  batchId,
  chatId,
  attachment,
  className = 'h-10 w-10',
}: {
  batchId?: string
  chatId?: string
  attachment: PreviewableAttachment
  className?: string
}) {
  const kind = previewKind(attachment)
  // Images and PDFs both have a server-rendered thumbnail.
  const hasThumb = kind === 'image' || kind === 'pdf'
  const { url, loading, unavailable } = useAttachmentBlobUrl(
    batchId,
    chatId,
    attachment.attachment_id,
    hasThumb,
    true,
    attachment.status,
    kind === 'image',
  )

  if (hasThumb && url) {
    return (
      <img
        src={url}
        alt=""
        className={`${className} flex-shrink-0 rounded-lg object-cover`}
      />
    )
  }

  return (
    <span
      className={`${className} flex flex-shrink-0 items-center justify-center rounded-lg bg-white/70 ${
        unavailable ? 'opacity-50' : ''
      }`}
    >
      {loading ? <Spinner size={14} /> : <KindIcon kind={kind} />}
    </span>
  )
}

/**
 * Full-screen viewer. Images render at size, text streams in as text, PDFs show
 * the generated page thumbnail with a page count.
 */
export function AttachmentViewer({
  batchId,
  chatId,
  attachment,
  onClose,
}: {
  batchId?: string
  chatId?: string
  attachment: PreviewableAttachment
  onClose: () => void
}) {
  const kind = previewKind(attachment)
  // Images and PDFs preview from bytes; PDFs use the server-made thumbnail
  // because there is no PDF renderer in the browser bundle.
  // Full bytes for both: browsers render PDFs natively, so an <iframe> beats a
  // one-page thumbnail. Content is served by the API (same-origin), which is
  // what makes this work at all — see get_attachment_bytes.
  const { url, loading, unavailable } = useAttachmentBlobUrl(
    batchId,
    chatId,
    attachment.attachment_id,
    kind === 'image' || kind === 'pdf' || kind === 'other',
    false,
  )
  const [text, setText] = useState('')
  const [textState, setTextState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')

  useEffect(() => {
    if (kind !== 'text' || !batchId || !chatId) return undefined
    let cancelled = false
    setTextState('loading')
    getChatAttachmentContent(batchId, chatId, attachment.attachment_id, false)
      .then((blob) => blob.text())
      .then((value) => {
        if (cancelled) return
        setText(value)
        setTextState('ready')
      })
      .catch(() => {
        if (!cancelled) setTextState('error')
      })
    return () => {
      cancelled = true
    }
  }, [kind, batchId, chatId, attachment.attachment_id])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const missing = unavailable || textState === 'error'
  const lineCount = text ? text.split('\n').length : 0
  const pageCount = attachment.page_count ?? 0

  return createPortal(
    <div
      className="fixed inset-0 z-[400] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={attachment.file_name}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="maia-glass-strong flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl">
        <header className="flex items-start justify-between gap-3 px-5 py-4">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-slate-900">{attachment.file_name}</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              {[
                formatBytes(attachment.size_bytes),
                kind === 'text' && lineCount ? `${lineCount} lines` : '',
                kind === 'pdf' && pageCount
                  ? `${pageCount} page${pageCount === 1 ? '' : 's'}`
                  : '',
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>
          <div className="flex flex-shrink-0 items-center gap-1">
            {url && (
              <a
                href={url}
                download={attachment.file_name}
                className="rounded-full p-2 text-slate-500 transition-colors hover:bg-white/70 hover:text-violet-700"
                aria-label={`Download ${attachment.file_name}`}
              >
                <Download className="h-4 w-4" />
              </a>
            )}
          <button
            type="button"
            onClick={onClose}
            className="flex-shrink-0 rounded-full p-2 text-slate-500 transition-colors hover:bg-white/70 hover:text-slate-800"
            aria-label="Close preview"
          >
            <X className="h-4 w-4" />
          </button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
          {missing ? (
            <div className="flex flex-col items-center justify-center gap-2 rounded-2xl bg-white/60 px-6 py-12 text-center">
              <KindIcon kind={kind} className="h-6 w-6 opacity-50" />
              <p className="text-sm font-medium text-slate-700">This file is no longer available</p>
              <p className="max-w-xs text-xs text-slate-500">
                Chat attachments are kept for 30 days. The details stay on the message, but
                the file itself has been removed.
              </p>
            </div>
          ) : loading || textState === 'loading' ? (
            <div className="flex items-center justify-center py-16">
              <Spinner size={28} />
            </div>
          ) : kind === 'image' && url ? (
            <img src={url} alt={attachment.file_name} className="mx-auto max-h-[64vh] rounded-xl" />
          ) : kind === 'pdf' && url ? (
            <iframe
              src={url}
              title={attachment.file_name}
              className="h-[64vh] w-full rounded-xl border border-white/60 bg-white"
            />
          ) : kind === 'text' ? (
            <pre className="mila-scroll max-h-[64vh] overflow-auto whitespace-pre-wrap rounded-xl bg-white/70 p-4 text-xs leading-5 text-slate-700">
              {text}
            </pre>
          ) : (
            <div className="flex flex-col items-center justify-center gap-3 rounded-2xl bg-white/60 px-6 py-12 text-center">
              <KindIcon kind={kind} className="h-6 w-6" />
              <p className="text-sm text-slate-600">
                This file type has no in-browser preview.
              </p>
              {url && (
                <a
                  href={url}
                  download={attachment.file_name}
                  className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-violet-700"
                >
                  <Download className="h-4 w-4" />
                  Download to open it
                </a>
              )}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}

/**
 * Preview tile for a not-yet-sent attachment, used by the chat composer and the
 * standalone generation forms.
 *
 * Preview only: no file name, no size, no status text. The tile is square and
 * large enough to actually read the page or image, and every detail the labels
 * used to carry is one tap away in the viewer. What does stay visual is the
 * state a lecturer must act on — processing dims the tile, and a rejected file
 * gets a red ring so "remove the flagged attachment" points at something.
 */
export function AttachmentCard({
  batchId,
  chatId,
  attachment,
  status,
  onOpen,
  onRemove,
}: {
  batchId?: string
  chatId?: string
  attachment: PreviewableAttachment
  /** Human status, surfaced in the tooltip rather than printed on the tile. */
  status?: string
  onOpen: () => void
  onRemove?: () => void
}) {
  const kind = previewKind(attachment)
  const hasThumb = kind === 'image' || kind === 'pdf'
  const { url } = useAttachmentBlobUrl(
    batchId,
    chatId,
    attachment.attachment_id,
    hasThumb,
    true,
    attachment.status,
    kind === 'image',
  )

  const processing = attachment.status === 'processing'
  const blocked = attachment.status === 'too_large' || attachment.status === 'failed'
  const tooltip = [attachment.file_name, formatBytes(attachment.size_bytes), status]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className="group relative">
      <button
        type="button"
        onClick={onOpen}
        title={tooltip}
        className={`relative flex h-[104px] w-[104px] items-center justify-center overflow-hidden rounded-2xl border bg-white/70 shadow-sm transition-all hover:shadow-md ${
          blocked ? 'border-red-300 ring-1 ring-red-200' : 'border-white/70 hover:border-white'
        }`}
        aria-label={`Preview ${attachment.file_name}`}
      >
        {hasThumb && url ? (
          // object-top so a portrait page shows its head rather than its middle.
          <img src={url} alt="" className="h-full w-full object-cover object-top" />
        ) : (
          <span className="flex h-full w-full flex-col items-center justify-center gap-1.5 bg-violet-50">
            <KindIcon kind={kind} className="h-6 w-6" />
            <span className="text-[11px] font-semibold tracking-wide text-violet-700">
              {formatBadge(attachment)}
            </span>
          </span>
        )}

        {processing && (
          <span className="absolute inset-0 flex items-center justify-center bg-white/60">
            <Spinner size={18} />
          </span>
        )}
      </button>

      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="absolute -right-1.5 -top-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 opacity-0 shadow-sm transition-opacity hover:text-red-600 group-hover:opacity-100 focus-visible:opacity-100"
          aria-label={`Remove ${attachment.file_name}`}
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  )
}
