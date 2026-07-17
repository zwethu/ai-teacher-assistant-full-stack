import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  ChevronDown,
  ExternalLink,
  FileText,
  Image as ImageIcon,
  Link2,
  Loader2,
  Paperclip,
  Trash2,
  X,
} from 'lucide-react'
import type { ChatAttachmentListItem, ChatMessage } from '../../../entity/Chat'
import { deleteChatAttachment, getChatAttachmentContent, listChatAttachments } from '../../../services/chatService'
import { collectUniqueChatWebLinks } from '../utils/webCitations'
import { SourceFavicon } from './SourceFavicon'

export type ChatSidePanelSection = 'links' | 'files'

type Props = {
  open: boolean
  onClose: () => void
  batchId: string
  chatId: string
  messages: ChatMessage[]
  initialSection?: ChatSidePanelSection | null
  onReferenceAttachment: (item: ChatAttachmentListItem) => void
}

function AccordionSection({
  title,
  icon,
  open,
  onToggle,
  children,
  count,
}: {
  title: string
  icon: React.ReactNode
  open: boolean
  onToggle: () => void
  children: React.ReactNode
  count?: number
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left transition-colors hover:bg-slate-50"
        aria-expanded={open}
      >
        <span className="text-slate-500">{icon}</span>
        <span className="flex-1 text-sm font-semibold text-slate-800">{title}</span>
        {typeof count === 'number' && (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">
            {count}
          </span>
        )}
        <ChevronDown
          className={`h-4 w-4 text-slate-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>
      <div
        className="grid transition-[grid-template-rows] duration-300 ease-out"
        style={{ gridTemplateRows: open ? '1fr' : '0fr' }}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="max-h-80 overflow-y-auto border-t border-slate-100 px-3 py-3">{children}</div>
        </div>
      </div>
    </section>
  )
}

function isUnsentAttachment(item: ChatAttachmentListItem): boolean {
  return !String(item.message_id || '').trim()
}

export function ChatSidePanel({
  open,
  onClose,
  batchId,
  chatId,
  messages,
  initialSection = null,
  onReferenceAttachment,
}: Props) {
  const [rendered, setRendered] = useState(false)
  const [visible, setVisible] = useState(false)
  const [linksOpen, setLinksOpen] = useState(false)
  const [filesOpen, setFilesOpen] = useState(false)
  const [items, setItems] = useState<ChatAttachmentListItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({})
  const thumbnailUrlsRef = useRef<string[]>([])
  const loadedChatKeyRef = useRef('')

  const links = useMemo(() => collectUniqueChatWebLinks(messages), [messages])

  useEffect(() => {
    if (open) {
      setRendered(true)
      const frame = requestAnimationFrame(() => setVisible(true))
      if (initialSection === 'files') {
        setFilesOpen(true)
        setLinksOpen(false)
      } else if (initialSection === 'links') {
        setLinksOpen(true)
        setFilesOpen(false)
      }
      return () => cancelAnimationFrame(frame)
    }
    setVisible(false)
    const timeout = window.setTimeout(() => setRendered(false), 300)
    return () => window.clearTimeout(timeout)
  }, [open, initialSection])

  useEffect(() => {
    if (!open) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = previous
      window.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])

  useEffect(() => () => {
    thumbnailUrlsRef.current.forEach((url) => URL.revokeObjectURL(url))
    thumbnailUrlsRef.current = []
  }, [])

  useEffect(() => {
    if (!open || !filesOpen) return
    const key = `${batchId}:${chatId}`
    if (loadedChatKeyRef.current === key && items.length > 0) return

    let cancelled = false
    async function load() {
      setLoading(true)
      setError('')
      try {
        const data = await listChatAttachments(batchId, chatId)
        if (cancelled) return
        setItems(data)
        loadedChatKeyRef.current = key
        for (const item of data.filter((value) => value.attachment_kind === 'image' && value.thumbnail_available).slice(0, 20)) {
          try {
            const blob = await getChatAttachmentContent(batchId, chatId, item.attachment_id, true)
            if (cancelled) return
            const url = URL.createObjectURL(blob)
            thumbnailUrlsRef.current.push(url)
            setThumbnails((prev) => ({ ...prev, [item.attachment_id]: url }))
          } catch {
            /* metadata remains usable */
          }
        }
      } catch {
        if (!cancelled) setError('Chat files are unavailable.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [open, filesOpen, batchId, chatId, items.length])

  useEffect(() => {
    loadedChatKeyRef.current = ''
    setItems([])
    setThumbnails({})
    thumbnailUrlsRef.current.forEach((url) => URL.revokeObjectURL(url))
    thumbnailUrlsRef.current = []
  }, [batchId, chatId])

  async function handleDelete(item: ChatAttachmentListItem) {
    if (!isUnsentAttachment(item)) return
    setDeletingId(item.attachment_id)
    try {
      await deleteChatAttachment(batchId, chatId, item.attachment_id)
      setItems((prev) => prev.filter((entry) => entry.attachment_id !== item.attachment_id))
      const thumb = thumbnails[item.attachment_id]
      if (thumb) {
        URL.revokeObjectURL(thumb)
        setThumbnails((prev) => {
          const next = { ...prev }
          delete next[item.attachment_id]
          return next
        })
      }
    } catch {
      setError('Could not delete that file. Only unsent files can be removed.')
    } finally {
      setDeletingId(null)
    }
  }

  if (!rendered) return null

  return createPortal(
    <div
      className={`fixed inset-0 z-[200] flex justify-end transition-colors duration-300 ${
        visible ? 'bg-slate-950/40 backdrop-blur-sm' : 'bg-transparent'
      }`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <aside
        className={`flex h-full w-full max-w-md flex-col overflow-hidden bg-white shadow-2xl transition-transform duration-300 ease-out ${
          visible ? 'translate-x-0' : 'translate-x-full'
        }`}
        role="dialog"
        aria-modal="true"
        aria-label="Chat links and files"
      >
        <header className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Chat resources</h2>
            <p className="text-xs text-slate-500">Web links and files from this conversation.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-2 text-slate-500 transition-colors hover:bg-slate-100"
            aria-label="Close chat resources"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
          <AccordionSection
            title="Links"
            icon={<Link2 className="h-4 w-4" />}
            open={linksOpen}
            onToggle={() => setLinksOpen((value) => !value)}
            count={links.length}
          >
            {links.length === 0 ? (
              <p className="text-xs text-slate-500">No web search links in this chat yet.</p>
            ) : (
              <ul className="space-y-2">
                {links.map((source) => (
                  <li key={source.url}>
                    <a
                      href={source.url}
                      target="_blank"
                      rel="noreferrer"
                      className="group flex items-start gap-2 rounded-lg border border-slate-100 px-2.5 py-2 transition-colors hover:border-emerald-200 hover:bg-emerald-50/50"
                    >
                      <SourceFavicon
                        domain={source.display_domain || source.domain}
                        url={source.url}
                        className="mt-0.5 h-4 w-4 flex-shrink-0 rounded-sm"
                        fallback={<ExternalLink className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-slate-400 group-hover:text-emerald-600" />}
                      />
                      <span className="min-w-0">
                        <span className="block truncate text-xs font-medium text-slate-800">
                          {source.title || source.display_domain || source.domain || source.url}
                        </span>
                        <span className="block truncate text-[11px] text-slate-400">
                          {source.display_domain || source.domain || source.url}
                        </span>
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </AccordionSection>

          <AccordionSection
            title="Files"
            icon={<Paperclip className="h-4 w-4" />}
            open={filesOpen}
            onToggle={() => setFilesOpen((value) => !value)}
            count={items.length}
          >
            <p className="mb-3 text-[10px] leading-4 text-slate-500">
              Chat files stay available in this chat for 7 days, then are removed. They are not saved to Course Space.
              Images remain chat-only. Sent files can be referenced again but not deleted here.
            </p>
            {loading ? (
              <div className="flex items-center gap-2 py-3 text-xs text-slate-500">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Loading files…
              </div>
            ) : error ? (
              <p className="text-xs text-red-600">{error}</p>
            ) : items.length === 0 ? (
              <p className="text-xs text-slate-500">No retained files in this chat.</p>
            ) : (
              <ul className="space-y-2">
                {items.map((item) => {
                  const unsent = isUnsentAttachment(item)
                  return (
                    <li
                      key={item.attachment_id}
                      className="flex items-center gap-2 rounded-lg border border-slate-100 p-2"
                    >
                      {thumbnails[item.attachment_id] ? (
                        <img
                          src={thumbnails[item.attachment_id]}
                          alt=""
                          className="h-9 w-9 rounded object-cover"
                        />
                      ) : item.attachment_kind === 'image' ? (
                        <ImageIcon className="h-5 w-5 flex-shrink-0 text-sky-600" />
                      ) : (
                        <FileText className="h-5 w-5 flex-shrink-0 text-emerald-600" />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium text-slate-700">
                          {item.file_title || item.file_name}
                        </p>
                        <p className="text-[11px] text-slate-400">
                          {item.attachment_kind === 'image'
                            ? `chat-only · vision ${item.vision_status === 'ready' ? 'ready' : item.vision_status}`
                            : item.status === 'processing'
                              ? 'processing…'
                              : item.status === 'failed'
                                ? 'processing failed'
                                : 'ready'}
                          {' · '}
                          {(item.size_bytes / 1024 / 1024).toFixed(1)} MB
                          {unsent ? ' · unsent' : ' · sent'}
                        </p>
                      </div>
                      <div className="flex flex-shrink-0 items-center gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            onReferenceAttachment(item)
                            onClose()
                          }}
                          className="rounded-md bg-emerald-50 px-2 py-1 text-[11px] font-medium text-emerald-700 transition-colors hover:bg-emerald-100"
                        >
                          Reference
                        </button>
                        {unsent && (
                          <button
                            type="button"
                            onClick={() => void handleDelete(item)}
                            disabled={deletingId === item.attachment_id}
                            className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
                            aria-label={`Delete ${item.file_title || item.file_name}`}
                          >
                            {deletingId === item.attachment_id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Trash2 className="h-3.5 w-3.5" />
                            )}
                          </button>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </AccordionSection>
        </div>
      </aside>
    </div>,
    document.body,
  )
}
