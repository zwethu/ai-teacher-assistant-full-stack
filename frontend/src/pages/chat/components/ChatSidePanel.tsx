import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  ChevronDown,
  ExternalLink,
  Gamepad2,
  Link2,
  Paperclip,
  Trash2,
  X,
} from 'lucide-react'
import type { ChatAttachmentListItem, ChatMessage } from '../../../entity/Chat'
import { deleteChatAttachment, listChatAttachments } from '../../../services/chatService'
import { deleteGame, listGames, type GameSession } from '../../../services/gameService'
import { collectUniqueChatWebLinks } from '../utils/webCitations'
import { SourceFavicon } from './SourceFavicon'
import { Spinner } from '../../../design-system'
import { AttachmentThumbnail, AttachmentViewer } from './AttachmentPreview'

export type ChatSidePanelSection = 'links' | 'files' | 'games'

type Props = {
  open: boolean
  onClose: () => void
  batchId: string
  chatId: string
  messages: ChatMessage[]
  initialSection?: ChatSidePanelSection | null
  onReferenceAttachment: (item: ChatAttachmentListItem) => void
}

/**
 * True when there is room for three columns (nav + conversation + resources).
 *
 * Falls back to `true` where matchMedia is unavailable (jsdom does not
 * implement it), so tests exercise the inline column — the primary layout.
 */
function useIsWideViewport(query = '(min-width: 1024px)'): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true
    return window.matchMedia(query).matches
  })

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined
    const mql = window.matchMedia(query)
    const onChange = () => setMatches(mql.matches)
    setMatches(mql.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [query])

  return matches
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

function formatShortDate(value?: string | null): string {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

/** A game's due date, when its lecturer set one. */
function formatDeadline(value?: string | null): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const due = date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
  return date.getTime() <= Date.now() ? `closed ${due}` : `due ${due}`
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
  const isWideViewport = useIsWideViewport()
  const [rendered, setRendered] = useState(false)
  const [visible, setVisible] = useState(false)
  const [linksOpen, setLinksOpen] = useState(false)
  const [filesOpen, setFilesOpen] = useState(false)
  const [items, setItems] = useState<ChatAttachmentListItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [preview, setPreview] = useState<ChatAttachmentListItem | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const loadedChatKeyRef = useRef('')
  // Games belong to the batch, not the chat, so they load and reset on batchId alone.
  const [gamesOpen, setGamesOpen] = useState(false)
  const [games, setGames] = useState<GameSession[]>([])
  const [gamesLoading, setGamesLoading] = useState(false)
  const [gamesError, setGamesError] = useState('')
  const [deletingGameId, setDeletingGameId] = useState<string | null>(null)
  const loadedGamesBatchRef = useRef('')

  const links = useMemo(() => collectUniqueChatWebLinks(messages), [messages])

  useEffect(() => {
    if (open) {
      setRendered(true)
      const frame = requestAnimationFrame(() => setVisible(true))
      if (initialSection === 'files') {
        setFilesOpen(true)
        setLinksOpen(false)
        setGamesOpen(false)
      } else if (initialSection === 'links') {
        setLinksOpen(true)
        setFilesOpen(false)
        setGamesOpen(false)
      } else if (initialSection === 'games') {
        setGamesOpen(true)
        setLinksOpen(false)
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
    // Locking body scroll is overlay behaviour. As an inline column the panel is
    // not modal — the conversation beside it must stay scrollable.
    const previous = document.body.style.overflow
    if (!isWideViewport) document.body.style.overflow = 'hidden'
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = previous
      window.removeEventListener('keydown', onKey)
    }
  }, [open, onClose, isWideViewport])

  useEffect(() => {
    if (!open || !filesOpen) return
    const key = `${batchId}:${chatId}`
    if (loadedChatKeyRef.current === key) return
    // Claim the key up front. This effect used to depend on `items.length`, so
    // its own setItems re-triggered it: the cleanup cancelled the in-flight
    // load mid thumbnail-fetch, its `finally` skipped setLoading(false) because
    // `cancelled` was true, and the re-run then bailed on the guard — leaving
    // "Loading files…" on screen forever.
    loadedChatKeyRef.current = key

    let cancelled = false
    async function load() {
      setLoading(true)
      setError('')
      try {
        const data = await listChatAttachments(batchId, chatId)
        if (cancelled) return
        setItems(data)
        // Thumbnails are decoration: the list is already usable, so stop the
        // spinner before fetching them rather than after.
        setLoading(false)
      } catch {
        if (cancelled) return
        setError('Chat files are unavailable.')
        // Allow a retry: the key must not stay claimed after a failure.
        loadedChatKeyRef.current = ''
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [open, filesOpen, batchId, chatId])

  useEffect(() => {
    loadedChatKeyRef.current = ''
    setItems([])
    setPreview(null)
  }, [batchId, chatId])

  useEffect(() => {
    if (!open || !gamesOpen) return
    if (loadedGamesBatchRef.current === batchId && games.length > 0) return

    let cancelled = false
    async function load() {
      setGamesLoading(true)
      setGamesError('')
      try {
        const data = await listGames(batchId)
        if (cancelled) return
        setGames(data)
        loadedGamesBatchRef.current = batchId
      } catch {
        if (!cancelled) setGamesError('Games are unavailable.')
      } finally {
        if (!cancelled) setGamesLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [open, gamesOpen, batchId, games.length])

  useEffect(() => {
    loadedGamesBatchRef.current = ''
    setGames([])
  }, [batchId])

  async function handleDelete(item: ChatAttachmentListItem) {
    if (!isUnsentAttachment(item)) return
    setDeletingId(item.attachment_id)
    try {
      await deleteChatAttachment(batchId, chatId, item.attachment_id)
      setItems((prev) => prev.filter((entry) => entry.attachment_id !== item.attachment_id))
    } catch {
      setError('Could not delete that file. Only unsent files can be removed.')
    } finally {
      setDeletingId(null)
    }
  }

  async function handleDeleteGame(game: GameSession) {
    setDeletingGameId(game.gameId)
    setGamesError('')
    try {
      await deleteGame(batchId, game.gameId)
      setGames((prev) => prev.filter((entry) => entry.gameId !== game.gameId))
    } catch {
      setGamesError('Could not delete that game.')
    } finally {
      setDeletingGameId(null)
    }
  }

  const panelBody = (
    <>
        <header className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Chat resources</h2>
            <p className="text-xs text-slate-500">
              Links and files from this conversation, plus games from this batch.
            </p>
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
                      className="group flex items-start gap-2 rounded-lg border border-slate-100 px-2.5 py-2 transition-colors hover:border-violet-200 hover:bg-violet-50/50"
                    >
                      <SourceFavicon
                        domain={source.display_domain || source.domain}
                        url={source.url}
                        className="mt-0.5 h-4 w-4 flex-shrink-0 rounded-sm"
                        fallback={<ExternalLink className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-slate-400 group-hover:text-violet-600" />}
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
              Chat files stay available in this chat for 30 days, then are removed. They are not saved to Course Space.
              Images remain chat-only. Sent files can be referenced again but not deleted here.
            </p>
            {loading ? (
              <div className="flex items-center gap-2 py-3 text-xs text-slate-500">
                <Spinner size={14} />
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
                      {/* Same affordance as the composer: the preview is the
                          control, and tapping it opens the full viewer. Images
                          and PDFs both have a server-rendered thumbnail, so
                          AttachmentThumbnail handles the fallback itself. */}
                      <button
                        type="button"
                        onClick={() => setPreview(item)}
                        className="flex-shrink-0 overflow-hidden rounded-lg border border-white/70 bg-white/70 shadow-sm transition-transform hover:scale-[1.04]"
                        aria-label={`Preview ${item.file_title || item.file_name}`}
                        title={item.file_title || item.file_name}
                      >
                        <AttachmentThumbnail
                          batchId={batchId}
                          chatId={chatId}
                          attachment={item}
                          className="h-11 w-11"
                        />
                      </button>
                      <div className="min-w-0 flex-1">
                        <button
                          type="button"
                          onClick={() => setPreview(item)}
                          className="block w-full truncate text-left text-xs font-medium text-slate-700 hover:text-violet-700"
                        >
                          {item.file_title || item.file_name}
                        </button>
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
                          className="rounded-md bg-violet-50 px-2 py-1 text-[11px] font-medium text-violet-700 transition-colors hover:bg-violet-100"
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
                              <Spinner size={14} />
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

          <AccordionSection
            title="Games"
            icon={<Gamepad2 className="h-4 w-4" />}
            open={gamesOpen}
            onToggle={() => setGamesOpen((value) => !value)}
            count={games.length}
          >
            <p className="mb-3 text-[10px] leading-4 text-slate-500">
              Study games created from this batch — not just this chat. Set or change a game's
              deadline on the Games page.
            </p>
            {gamesLoading ? (
              <div className="flex items-center gap-2 py-3 text-xs text-slate-500">
                <Spinner size={14} />
                Loading games…
              </div>
            ) : gamesError ? (
              <p className="text-xs text-red-600">{gamesError}</p>
            ) : games.length === 0 ? (
              <p className="text-xs text-slate-500">
                No games yet. Attach a PDF and pick Study Game from the ⊕ menu to create one.
              </p>
            ) : (
              <ul className="space-y-2">
                {games.map((game) => {
                  const created = formatShortDate(game.createdAt)
                  const deadline = formatDeadline(game.deadlineAt)
                  return (
                    <li
                      key={game.gameId}
                      className="flex items-center gap-2 rounded-lg border border-slate-100 p-2"
                    >
                      <Gamepad2 className="h-5 w-5 flex-shrink-0 text-violet-600" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium text-slate-700">{game.title}</p>
                        <p className="text-[11px] text-slate-400">
                          {game.itemCount} pair{game.itemCount === 1 ? '' : 's'}
                          {created ? ` · created ${created}` : ''}
                          {deadline ? ` · ${deadline}` : ''}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => void handleDeleteGame(game)}
                        disabled={deletingGameId === game.gameId}
                        className="flex-shrink-0 rounded-md p-1.5 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
                        aria-label={`Delete ${game.title}`}
                      >
                        {deletingGameId === game.gameId ? (
                          <Spinner size={14} />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </AccordionSection>
        </div>

      {/* Same viewer the composer uses, so a file opens identically whether it
          is being attached or looked up later. */}
      {preview && (
        <AttachmentViewer
          batchId={batchId}
          chatId={chatId}
          attachment={preview}
          onClose={() => setPreview(null)}
        />
      )}
    </>
  )

  // Rendered as a column OR as an overlay — never both. Doing it with CSS alone
  // would leave two copies of the whole panel in the DOM, which duplicates every
  // control and breaks any query that expects one.
  if (isWideViewport) {
    return (
      // Wide screens: a real column beside the conversation, so the chat stays
      // readable while resources are open. Width animates from 0, so the
      // conversation gives up space rather than being covered.
      <aside
        className={`shrink-0 overflow-hidden transition-[width] duration-300 ease-out ${
          open ? 'w-[360px]' : 'w-0'
        }`}
        aria-hidden={!open}
        aria-label="Chat links, files, and games"
      >
        <div
          className="maia-glass flex h-full w-[360px] flex-col overflow-hidden"
          style={{ borderLeft: '1px solid var(--border-academic)' }}
        >
          {panelBody}
        </div>
      </aside>
    )
  }

  return (
    <>
      {/* Narrow: no room for three columns, so it stays an overlay. */}
      {rendered &&
        createPortal(
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
              aria-label="Chat links, files, and games"
            >
              {panelBody}
            </aside>
          </div>,
          document.body,
        )}
    </>
  )
}
