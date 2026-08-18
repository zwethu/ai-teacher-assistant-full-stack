import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type RefObject,
} from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { BatchFile } from '../../../entity/File'
import type { Chat } from '../../../entity/Chat'
import axios from 'axios'
import {
  AlertCircle,
  Clock,
  FileText,
  MessageCircle,
  Pencil,
  RefreshCw,
  Send,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import {
  createChat,
  deleteChat,
  CHAT_PAGE_SIZE,
  listChats,
  updateChatTitle,
  uploadChatAttachment,
} from '../../../services/chatService'
import { formatDateTime } from '../../../utils/formatDate'
import { emitChatCreated } from '../../../utils/chatEvents'
import { BTN_SECONDARY } from '../constants'
import { IndexStatusBadge } from './IndexStatusBadge'
import { Menu, MenuItem } from '../../../components/ui/Menu'
import { confirm } from '../../../components/ui/confirmStore'
import { undoable, usePendingUndo } from '../../../components/ui/undoStore'
import { IconButton, Spinner } from '../../../design-system'
import type { GenerateMode } from '../../chat/components/ComposerSurface'
import {
  COMPOSER_EXIT_MS,
  COMPOSER_TEXTAREA_CLASS,
  ComposerAddMenu,
  ComposerCollapse,
  ComposerControls,
  ComposerHint,
  ComposerModeChip,
  ComposerSpacer,
  ComposerSurface,
  ComposerTint,
  WebSearchToggle,
  modeSpec,
  useComposerPresence,
} from '../../chat/components/ComposerSurface'

type Props = {
  batchId: string
  files: BatchFile[]
  filesLoading: boolean
  fileUploading: boolean
  fileInputRef: RefObject<HTMLInputElement | null>
  onFileUpload: (e: ChangeEvent<HTMLInputElement>) => void
  onDeleteFile: (file: BatchFile) => void
  onRefreshFiles: () => void
}

/**
 * The openings under the composer.
 *
 * Short label, full prompt. The chat page's `SUGGESTIONS` are whole sentences,
 * which is right for a centred hero at `max-w-lg` and wrong here: four of them
 * wrapped onto a second row above a floating card, so the card grew a ragged
 * two-line hat. The label is what has to fit on one line; the prompt is what
 * the lecturer actually meant.
 */
const SESSION_PROMPTS: Array<{ label: string; prompt: string }> = [
  { label: 'Plan a lesson', prompt: 'Help me plan a lesson on this topic' },
  { label: 'Create a quiz', prompt: 'Create a quiz for my students' },
  { label: 'Draft an email', prompt: 'Draft an announcement email' },
  { label: 'Summarise materials', prompt: 'Summarise the uploaded materials' },
]

/** A file chosen in the composer but not yet uploaded anywhere. */
type StagedFile = { id: string; file: File; previewUrl: string }

/**
 * Preview tile for a staged file. Deliberately not the chat composer's
 * AttachmentCard: that one loads its preview from the server by attachment id,
 * and a staged file has no id yet. Same 104px preview-only shape, drawn from
 * the local File instead.
 */
function StagedFileTile({ staged, onRemove }: { staged: StagedFile; onRemove: () => void }) {
  const extension = (staged.file.name.split('.').pop() || '').slice(0, 4).toUpperCase()
  return (
    <div className="group relative">
      <div
        title={staged.file.name}
        className="flex h-[104px] w-[104px] items-center justify-center overflow-hidden rounded-2xl border border-white/70 bg-white/70 shadow-sm"
      >
        {staged.previewUrl ? (
          <img src={staged.previewUrl} alt="" className="h-full w-full object-cover object-top" />
        ) : (
          <span className="flex h-full w-full flex-col items-center justify-center gap-1.5 bg-violet-50">
            <FileText className="h-6 w-6 text-violet-600" />
            <span className="text-[11px] font-semibold tracking-wide text-violet-700">{extension}</span>
          </span>
        )}
      </div>
      <button
        type="button"
        onClick={onRemove}
        className="absolute -right-1.5 -top-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 opacity-0 shadow-sm transition-opacity hover:text-red-600 group-hover:opacity-100 focus-visible:opacity-100"
        aria-label={`Remove ${staged.file.name}`}
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  )
}

/**
 * What the badge beside it cannot say — and nothing when there is nothing.
 *
 * `IndexStatusBadge` already carries `index_status` in full: Uploading,
 * Pending, Indexing, Indexed, Failed, Deleting. This line used to restate it,
 * so a finished file read "Indexed" twice in a row, once as a pill and once as
 * plain text underneath.
 *
 * The only fact the badge cannot carry is the *overlay* — whether MILA can
 * already use the file while durable indexing catches up. So that is all this
 * says, in the one term a lecturer has: can it be used yet. "Overlay",
 * "durable" and "retained temporarily" were the backend's words for its own
 * two-stage pipeline, and none of them told a lecturer anything they could act
 * on.
 */
export function batchFileStatusLabel(file: BatchFile): string {
  // Indexing failed, but the file went in far enough to be read for now.
  if (file.overlay_status === 'ready' && file.index_status === 'failed') {
    return 'Usable in chats for now, but it will not be searchable.'
  }
  // The reverse: nothing to read from yet, and still working on it.
  if (file.overlay_status === 'failed' && ['pending', 'indexing'].includes(file.index_status)) {
    return 'Not usable yet — still processing.'
  }
  // Usable already, while the slower pass finishes.
  if (file.overlay_status === 'ready' && file.index_status !== 'indexed') {
    return 'Usable now, while it finishes processing.'
  }
  // Everything else — including `retiring`, which is the backend retiring its
  // own temporary copy and means nothing to a lecturer — is fully described by
  // the badge on its own.
  return ''
}

// Per-space indexed-file cap. Mirrors the backend default (COURSE_SPACE_MAX_FILES,
// services/file_service.py:get_course_space_max_files); the backend is the source of
// truth and rejects uploads past it — this just surfaces the limit up front.
const MAX_COURSE_SPACE_FILES = 10

export function MaterialsTab({
  batchId,
  files,
  filesLoading,
  fileUploading,
  fileInputRef,
  onFileUpload,
  onDeleteFile,
  onRefreshFiles,
}: Props) {
  const atFileLimit = files.length >= MAX_COURSE_SPACE_FILES
  const navigate = useNavigate()
  const [chats, setChats] = useState<Chat[]>([])
  const [chatsLoading, setChatsLoading] = useState(true)
  // Optimistic until a page comes back shorter than asked for — the endpoint
  // returns a bare array, so a short page is the only end-of-list signal.
  const [hasMoreChats, setHasMoreChats] = useState(true)
  const [loadingMoreChats, setLoadingMoreChats] = useState(false)
  const [input, setInput] = useState('')
  const [creating, setCreating] = useState(false)
  // Matches the chat page's default so the toggle means the same thing here.
  const [webSearch, setWebSearch] = useState(true)
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null)
  // Chats inside their undo window: hidden here, still on the server.
  const pendingUndo = usePendingUndo()
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [composerMenuOpen, setComposerMenuOpen] = useState(false)
  const [generateMode, setGenerateMode] = useState<GenerateMode | null>(null)
  // Files are staged in the browser and only uploaded on send. Nothing here
  // touches the server before then, so browsing away — or attaching a file and
  // changing your mind — cannot leave an empty "New Chat" behind.
  const [stagedFiles, setStagedFiles] = useState<StagedFile[]>([])
  // Holds a removed tile for the length of its exit animation — see
  // useComposerPresence. Sending clears the whole list at once, and that is
  // the case this makes look deliberate rather than abrupt.
  const stagedEntries = useComposerPresence(stagedFiles, (staged) => staged.id)
  const [attachmentErrors, setAttachmentErrors] = useState<string[]>([])
  const composerRef = useRef<HTMLDivElement | null>(null)
  // Fallback until the observer reports; roughly an empty composer plus hint.
  const [composerHeight, setComposerHeight] = useState(150)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const renameInputRef = useRef<HTMLInputElement>(null)
  const composerMenuRef = useRef<HTMLDivElement>(null)
  const attachmentInputRef = useRef<HTMLInputElement>(null)

  const loadChats = useCallback(async () => {
    setChatsLoading(true)
    try {
      // One request. The preview rides along on each chat document, so this no
      // longer fans out into a messages fetch per chat on every visit.
      const page = await listChats(batchId, { limit: CHAT_PAGE_SIZE })
      setChats(page)
      setHasMoreChats(page.length >= CHAT_PAGE_SIZE)
    } catch (err) {
      console.error(err)
      setChats([])
    } finally {
      setChatsLoading(false)
    }
  }, [batchId])

  /** The page below the one shown. Explicit rather than scroll-triggered: this
   *  is a section of a scrolling page, not a pane with a bottom of its own. */
  const loadOlderChats = useCallback(async () => {
    const cursor = chats.at(-1)?.created_at
    if (loadingMoreChats || !hasMoreChats || !cursor) return
    setLoadingMoreChats(true)
    try {
      const page = await listChats(batchId, { limit: CHAT_PAGE_SIZE, before: cursor })
      if (page.length < CHAT_PAGE_SIZE) setHasMoreChats(false)
      setChats((prev) => {
        const known = new Set(prev.map((chat) => chat.chat_id))
        const fresh = page.filter((chat) => !known.has(chat.chat_id))
        return fresh.length > 0 ? [...prev, ...fresh] : prev
      })
    } catch (err) {
      console.error(err)
    } finally {
      setLoadingMoreChats(false)
    }
  }, [batchId, chats, hasMoreChats, loadingMoreChats])

  useEffect(() => {
    void loadChats()
  }, [loadChats])

  /* The composer overlays the scroller, so the scroller has to reserve exactly
     its height — measured, not assumed, because the suggestion row appears and
     disappears and a wrapped composer grows. This is the same arrangement the
     chat page uses (`ChatLayout.tsx`), and copying it is the point: an earlier
     attempt put the composer in normal flow with `mt-auto`, which pins nothing
     unless every ancestor resolves a definite height. */
  useEffect(() => {
    const node = composerRef.current
    if (!node || typeof ResizeObserver === 'undefined') return undefined
    let frame = 0
    const observer = new ResizeObserver(() => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        setComposerHeight(node.offsetHeight)
      })
    })
    observer.observe(node)
    return () => {
      if (frame) cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [])

  useEffect(() => {
    if (!menuOpenId) return

    function handleMouseDown(e: MouseEvent) {
      if (e.target instanceof Element && e.target.closest('[data-chat-menu]')) return
      setMenuOpenId(null)
    }

    document.addEventListener('mousedown', handleMouseDown)
    return () => document.removeEventListener('mousedown', handleMouseDown)
  }, [menuOpenId])

  useEffect(() => {
    if (!composerMenuOpen) return undefined
    function handlePointerDown(e: MouseEvent) {
      if (composerMenuRef.current && !composerMenuRef.current.contains(e.target as Node)) {
        setComposerMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [composerMenuOpen])

  function handleTextareaInput() {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }

  function handleAttachmentFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || [])
    event.target.value = ''
    if (!files.length) return
    const errors: string[] = []
    const slots = Math.max(0, 5 - stagedFiles.length)
    if (files.length > slots) errors.push('A message can include at most 5 attachments.')
    setAttachmentErrors(errors)
    setStagedFiles((prev) => [
      ...prev,
      ...files.slice(0, slots).map((file) => ({
        id: crypto.randomUUID(),
        file,
        // Only images get a local thumbnail; everything else shows its badge
        // until it reaches the chat, where the server-rendered preview takes over.
        previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : '',
      })),
    ])
  }

  function removeStagedFile(id: string) {
    setStagedFiles((prev) => {
      const removed = prev.find((item) => item.id === id)
      // Revoked after the tile has finished leaving, not as it starts: the
      // ghost is still on screen for COMPOSER_EXIT_MS and is still rendering
      // from this URL.
      if (removed?.previewUrl) {
        window.setTimeout(() => URL.revokeObjectURL(removed.previewUrl), COMPOSER_EXIT_MS)
      }
      return prev.filter((item) => item.id !== id)
    })
  }

  function selectGenerateMode(mode: GenerateMode) {
    setGenerateMode(mode)
    setComposerMenuOpen(false)
    requestAnimationFrame(() => textareaRef.current?.focus())
  }

  function handleInputKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void handleStartChat()
    }
  }

  async function handleStartChat() {
    const content =
      input.trim() || (stagedFiles.length ? 'Please review the attached file(s).' : '')
    if (!content || creating) return

    setCreating(true)
    setAttachmentErrors([])
    try {
      // The chat is created here and nowhere else, so an abandoned composer
      // never leaves one behind. Files upload into it immediately after.
      const chat = await createChat(batchId, content.slice(0, 50) || 'New Chat')
      emitChatCreated()

      const attachmentIds: string[] = []
      const errors: string[] = []
      for (const staged of stagedFiles) {
        try {
          const uploaded = await uploadChatAttachment(batchId, chat.chat_id, staged.file)
          attachmentIds.push(uploaded.attachment_id)
        } catch (err) {
          const detail = axios.isAxiosError(err) ? err.response?.data?.detail : ''
          errors.push(`${staged.file.name}: ${typeof detail === 'string' ? detail : 'Upload failed.'}`)
        }
      }
      if (errors.length) {
        // Some file did not make it. The chat exists and the rest uploaded, so
        // go anyway rather than stranding the user — but say what was dropped.
        setAttachmentErrors(errors)
      }

      stagedFiles.forEach((staged) => staged.previewUrl && URL.revokeObjectURL(staged.previewUrl))
      setInput('')
      setStagedFiles([])
      setGenerateMode(null)
      // The chat page picks these up once its messages have loaded and sends
      // the first message with them, so this composer stays a launcher.
      navigate(`/batches/${batchId}/chats/${chat.chat_id}`, {
        state: { initialMessage: content, webSearch, generateMode, attachmentIds },
      })
    } catch (err) {
      console.error(err)
      setAttachmentErrors(['Could not start the chat. Please try again.'])
    } finally {
      setCreating(false)
    }
  }

  function startRename(chat: Chat) {
    setRenamingId(chat.chat_id)
    setRenameValue(chat.title)
    setMenuOpenId(null)
    setTimeout(() => renameInputRef.current?.focus(), 50)
  }

  async function commitRename() {
    if (!renamingId) return
    const title = renameValue.trim() || 'New Chat'
    await updateChatTitle(batchId, renamingId, title)
    setChats((prev) =>
      prev.map((chat) => (chat.chat_id === renamingId ? { ...chat, title } : chat)),
    )
    setRenamingId(null)
  }

  function cancelRename() {
    setRenamingId(null)
  }

  /* Ask, then hold — the same flow as every other delete in the app. The row
     used to swap its menu button for a tick and a cross, two small targets
     side by side where the left one deleted the conversation outright. */
  /* What the list shows: everything except the chats waiting out their undo
     window. `chats` itself is untouched, so undoing simply stops hiding one. */
  const visibleChats = chats.filter((chat) => !pendingUndo.has(chat.chat_id))

  async function handleDeleteChat(chat: Chat) {
    const ok = await confirm({
      title: `Delete "${chat.title}"?`,
      body: 'Every message in this conversation goes with it.',
      confirmLabel: 'Delete',
      tone: 'danger',
    })
    if (!ok) return

    undoable({
      id: chat.chat_id,
      message: `Deleted "${chat.title}".`,
      commit: async () => {
        try {
          await deleteChat(batchId, chat.chat_id)
          setChats((prev) => prev.filter((item) => item.chat_id !== chat.chat_id))
        } catch (err) {
          console.error(err)
        }
      },
    })
  }

  return (
    /* Fills the tab so the composer band below has a full-height parent to pin
       to. Without these classes the whole chain below sizes to its content. */
    <div className="flex h-full min-h-0 flex-col">
      {/* The positioned parent the composer band pins to.
          ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄
          `flex-1` here is load-bearing and only works because the root above
          it is a flex column with a resolved height. That chain broke once
          already — the root was left as a bare `<div>`, so this wrapper sized
          to its content and the composer's `bottom-0` landed 456px above the
          bottom of the screen. Measured, not guessed: `scripts/` has no test
          for it, so the guard is in `MaterialsTab.structure.test.tsx`. */}
      <div className="relative min-h-0 flex-1">
      <div
        className="grid h-full grid-cols-1 gap-6 overflow-y-auto lg:grid-cols-[minmax(0,1fr)_24rem]"
        /* Reserves the composer's own height, so the last row of the list
           scrolls clear of it instead of coming to rest underneath. */
        style={{ paddingBottom: composerHeight }}
      >
        {/* The column stretches; the card inside it does not. That distinction
            is the whole fix — an earlier version put `lg:h-full` on the card
            and stretched a panel holding two rows to the full viewport. Here
            the column takes the height so the composer has somewhere to be
            pushed to, and the card stays exactly as tall as its rows.

            No `max-w` on the column either. Capping it at `max-w-2xl` left a
            dead band between the list and the rail wide enough to read as a
            missing third column. */}
        <section className="flex min-w-0 flex-col gap-6 pb-2">
          {/* A real surface, so the list reads as an object rather than as
              text lying on the page — but one that sizes to its content. The
              card was never the problem; `lg:h-full` was. A panel holding two
              rows used to be stretched to the full viewport, and that is where
              the empty white came from. */}
          <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
            <h3 className="flex items-center gap-2 border-b border-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-700">
              <MessageCircle className="h-4 w-4 text-violet-600" />
              Recent
            </h3>
            {chatsLoading ? (
              <div className="flex items-center gap-2 px-4 py-5 text-sm text-slate-500">
                <Spinner size={16} /> Loading chats…
              </div>
            ) : visibleChats.length === 0 ? (
              <p className="px-4 py-5 text-sm text-slate-500">
                Nothing yet — your chats about this batch will collect here.
              </p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {visibleChats.map((chat) => (
                  <li key={chat.chat_id} className="group relative">
                    {/* The row is a real link, not a `div` with an `onClick`.
                        Opening a past chat is this tab's first job and it had
                        no tab stop, no accessible name and no Enter handler —
                        a keyboard or screen-reader user could not do it at
                        all. A link rather than a button because it navigates,
                        which also buys middle-click-to-new-tab: genuinely
                        useful when comparing two weeks' prep side by side.

                        It sits *behind* the row rather than wrapping it, so
                        the rename field and the action menu are siblings of
                        the click target instead of nested inside it — nesting
                        a text input in a link is invalid, and it was why the
                        input needed a `stopPropagation` to survive. */}
                    {renamingId !== chat.chat_id && (
                      <Link
                        to={`/batches/${batchId}/chats/${chat.chat_id}`}
                        /* `aria-label`, not an `sr-only` span. The title is
                           already on screen in a sibling, so a hidden copy
                           inside the link had a screen reader read it twice —
                           and made it ambiguous to anything matching on text. */
                        aria-label={chat.title}
                        className="absolute inset-0 z-0 rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
                      />
                    )}
                    <div className="pointer-events-none relative z-10 w-full rounded-xl px-4 py-3 text-left transition-colors group-hover:bg-violet-50/60 group-focus-within:bg-violet-50/60">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          {renamingId === chat.chat_id ? (
                            <input
                              ref={renameInputRef}
                              value={renameValue}
                              onChange={(e) => setRenameValue(e.target.value)}
                              onBlur={() => void commitRename()}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') void commitRename()
                                if (e.key === 'Escape') cancelRename()
                              }}
                              aria-label="Rename chat"
                              className="pointer-events-auto w-full border-b border-violet-400 bg-transparent text-sm font-medium text-slate-900 outline-none"
                            />
                          ) : (
                            <div className="truncate text-sm font-medium text-slate-900">
                              {chat.title}
                            </div>
                          )}
                          {chat.preview && renamingId !== chat.chat_id && (
                            <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">
                              {chat.preview}
                            </p>
                          )}
                        </div>
                        <div className="flex flex-shrink-0 items-start gap-2">
                          <span className="whitespace-nowrap text-xs text-slate-400">
                            {chat.updated_at || chat.created_at
                              ? formatDateTime(chat.updated_at ?? chat.created_at)
                              : '—'}
                          </span>
                          {/* `group-focus-within` alongside `group-hover`: the
                              cluster used to be reachable by keyboard while
                              rendered at zero opacity. */}
                          <div
                            className={`pointer-events-auto relative flex items-center gap-0.5 transition-opacity ${
                              menuOpenId === chat.chat_id
                                ? 'opacity-100'
                                : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'
                            }`}
                            data-chat-menu
                          >
                            {
                              /* The panel is portalled, so it escapes this
                                 card's `overflow-hidden` — the last row's menu
                                 used to be sliced off at the card's edge — and
                                 flips upward when there is no room below. */
                              <Menu
                                label="Chat actions"
                                width="w-44"
                                onOpenChange={(open) =>
                                  setMenuOpenId(open ? chat.chat_id : null)
                                }
                              >
                                <MenuItem
                                  icon={<Pencil className="h-4 w-4" />}
                                  onSelect={() => startRename(chat)}
                                >
                                  Rename
                                </MenuItem>
                                <MenuItem
                                  danger
                                  icon={<Trash2 className="h-4 w-4" />}
                                  onSelect={() => void handleDeleteChat(chat)}
                                >
                                  Delete
                                </MenuItem>
                              </Menu>
                            }
                          </div>
                        </div>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {hasMoreChats && !chatsLoading && visibleChats.length > 0 && (
              <button
                type="button"
                onClick={() => void loadOlderChats()}
                disabled={loadingMoreChats}
                className="inline-flex w-full items-center justify-center gap-2 border-t border-slate-100 px-3 py-2.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loadingMoreChats && <Spinner size={14} tone="muted" />}
                {loadingMoreChats ? 'Loading...' : 'Show older chats'}
              </button>
            )}
          </div>

          {/* Floating, not docked.
              ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄
              `mt-auto` puts it at the foot of the column, so on a short list
              it lands at the bottom of the screen rather than tucked under the
              last row with a screen of dead space beneath it. `sticky` takes
              over once the list outgrows the viewport, and `bottom-4` keeps it
              clear of the edge — flush at `bottom-0` is the grammar of a
              toolbar bolted to the window.

              Capped at `max-w-3xl` and centred, so it is narrower than the
              list it floats over. Matching the list's width would make it read
              as another panel in the stack rather than as a thing on top.

              No band behind it either. `.mila-composer-surface` is already a
              floating plane: glass at 0.75 opacity, a 28px backdrop blur and a
              low diffuse shadow, all written for exactly this. Laying a second
              blurred scrim behind it was covering up the thing that makes it
              read as floating in the first place. */}
        </section>

        {/* One block, one job.
            ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄
            This rail used to stack three unrelated things in three different
            container grammars: a navigation target, an action, and a status
            list. The navigation target was a 190px tinted card whose whole
            function was to switch to the Planning tab — the first tab in the
            strip, forty pixels above it — and it cost exactly the vertical
            budget that pushed the file list off a 768px laptop. Its facts now
            live in the batch header, beside the student count, where facts
            about the batch already are.

            No nested `overflow-y-auto` either: the rail scrolled inside a
            page that also scrolled, with no affordance saying so. */}
        <aside className="min-w-0 self-start rounded-2xl border border-slate-100 bg-white shadow-sm">
          <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
            <h3 className="flex min-w-0 items-center gap-2 text-sm font-semibold text-slate-700">
              <FileText className="h-4 w-4 flex-shrink-0 text-violet-600" />
              Course materials
              <span className="text-xs font-normal text-slate-500">
                {files.length} / {MAX_COURSE_SPACE_FILES}
              </span>
            </h3>
            <div className="flex flex-shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={onRefreshFiles}
                disabled={filesLoading}
                className="inline-flex items-center justify-center rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50"
                aria-label="Refresh files"
                title="Refresh files"
              >
                <RefreshCw className={`h-4 w-4 ${filesLoading ? 'animate-spin' : ''}`} />
              </button>
              <input
                ref={fileInputRef}
                type="file"
                /* `.pptx` was missing and is the format a lecturer is most
                   likely to reach for. The two pickers on this screen still
                   differ — this one indexes into the batch, the composer's
                   attaches to one message — but that is now said in words
                   below rather than left to be discovered. */
                accept=".pdf,.pptx,.docx,.txt,.md,.markdown,.json"
                onChange={onFileUpload}
                disabled={fileUploading || atFileLimit}
                className="sr-only"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={fileUploading || atFileLimit}
                className={`${BTN_SECONDARY} px-2.5 py-1.5 text-xs`}
              >
                {fileUploading ? <Spinner size={14} /> : <Upload className="h-3.5 w-3.5" />}
                {fileUploading ? 'Uploading…' : 'Upload'}
              </button>
            </div>
          </div>
          <div className="border-b border-slate-100 px-4 py-2.5">
            {/* Named by consequence, not mechanism. A lecturer who uploads
                slides through the composer instead believes MILA "has" them,
                then finds next week's chat does not. */}
            <p className="text-xs text-slate-500">
              MILA reads these in every chat about this batch. To send a file to one
              message only, attach it in the composer instead.
            </p>
            {atFileLimit && (
              <p role="status" className="mt-1.5 text-xs font-medium text-amber-700">
                {MAX_COURSE_SPACE_FILES}-file limit reached — remove one to add another.
              </p>
            )}
          </div>
          <div>
            <div className="max-h-[28rem] overflow-y-auto">
              {filesLoading && files.length === 0 ? (
                <div className="flex items-center gap-2 px-4 py-4 text-sm text-slate-500">
                  <Spinner size={16} /> Loading files…
                </div>
              ) : files.length === 0 ? (
                <p className="px-4 py-4 text-sm text-slate-500">
                  No materials yet. Upload a syllabus, slides or reading and MILA will
                  use them.
                </p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {files.map((f) => (
                    <li key={f.file_id} className="px-4 py-3 transition-colors hover:bg-slate-50/80">
                      <div className="flex items-start gap-2">
                        <FileText className="mt-0.5 h-4 w-4 flex-shrink-0 text-slate-400" />
                        <div className="min-w-0 flex-1">
                          <div
                            className="truncate text-sm font-medium text-slate-900"
                            title={f.file_name}
                          >
                            {f.file_title || f.file_name}
                          </div>
                          <div className="mt-1">
                            <IndexStatusBadge status={f.index_status} />
                            {/* Only when it has something the badge does not
                                say. Rendered unconditionally it left an empty
                                paragraph holding its own `mt-1` open under
                                every finished file. */}
                            {batchFileStatusLabel(f) && (
                              <p className="mt-1 text-xs font-medium text-slate-600">
                                {batchFileStatusLabel(f)}
                              </p>
                            )}
                            {['uploading', 'pending', 'indexing', 'deleting'].includes(
                              f.index_status,
                            ) && (
                              <p className="mt-1 animate-pulse text-xs text-slate-500">
                                {f.index_message || 'Indexing in progress...'}
                              </p>
                            )}
                            {/* A failed index used to be a raw backend string
                                in red with no way out — the one recovery is
                                delete and re-upload, and nothing said so. */}
                            {f.index_error && (
                              <div role="alert" className="mt-1.5 rounded-md bg-red-50 px-2 py-1.5">
                                <p className="flex items-start gap-1.5 text-xs font-medium text-red-800">
                                  <AlertCircle className="mt-px h-3.5 w-3.5 flex-shrink-0" />
                                  Could not index this file.
                                </p>
                                <p className="mt-0.5 break-words text-xs text-red-700">
                                  {f.index_error}
                                </p>
                                <p className="mt-1 text-xs text-red-700">
                                  Delete it and upload again to retry.
                                </p>
                              </div>
                            )}
                            {f.overlay_warning && (
                              <p role="status" className="mt-1 break-words text-xs text-amber-700">
                                {f.overlay_warning}
                              </p>
                            )}
                          </div>
                          {f.created_at && (
                            <span className="mt-1 flex items-center gap-1 text-xs text-slate-400">
                              <Clock className="h-3 w-3" />
                              {formatDateTime(new Date(f.created_at))}
                            </span>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => onDeleteFile(f)}
                          disabled={f.index_status === 'deleting'}
                          className="flex-shrink-0 rounded-md p-1.5 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                          aria-label="Delete file"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </aside>
      </div>
      {/* Pinned to the foot of the column, with the list running beneath it.
          ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄
          Absolutely positioned over the scroller rather than placed in flow —
          the arrangement `ChatLayout.tsx` already uses, and the reason this
          finally stays down. `mt-auto` and `sticky` both need every ancestor
          to resolve a definite height; an overlay needs only a positioned
          parent, which is the wrapper around the grid.

          The band repeats the grid's own template with an empty second cell,
          so the composer lands over the *left* column exactly, without a magic
          number tracking the rail's width.

          `pointer-events-none` on the band and `auto` on the card: the band
          spans the full width and would otherwise swallow clicks on the
          materials rail behind it. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <div ref={composerRef} className="pointer-events-auto mx-auto w-full max-w-3xl pb-4">
              {attachmentErrors.length > 0 && (
                <div role="alert" className="mb-2 space-y-1">
                  {attachmentErrors.map((error) => (
                    <p key={error} className="flex items-start gap-1.5 text-xs text-red-700">
                      <AlertCircle className="mt-px h-3.5 w-3.5 flex-shrink-0" />
                      {error}
                    </p>
                  ))}
                </div>
              )}
              {/* Openings, above the field they fill and centred with it — but
                  only until the lecturer has started. Once there is something in
                  the composer they are noise sitting under her hands, and they
                  would pad the floating card for the whole session. */}
              {!input.trim() && stagedFiles.length === 0 && (
                <div className="no-scrollbar mb-3 flex justify-center gap-2 overflow-x-auto">
                  {SESSION_PROMPTS.map(({ label, prompt }) => (
                    <button
                      key={label}
                      type="button"
                      title={prompt}
                      onClick={() => {
                        setInput(prompt)
                        textareaRef.current?.focus()
                      }}
                      disabled={creating}
                      /* `flex-shrink-0` with the row scrolling rather than
                         wrapping: one line at every width, and on a narrow
                         screen the tail is reachable by swipe instead of
                         stacking a second row under the composer. */
                      className="flex-shrink-0 whitespace-nowrap rounded-full border border-slate-200 bg-white/70 px-3 py-1.5 text-xs font-medium text-slate-600 backdrop-blur transition-colors hover:border-violet-300 hover:bg-violet-50 hover:text-violet-800 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
              <ComposerTint active={webSearch}>
                <ComposerSurface>
                  <ComposerCollapse
                    open={stagedEntries.length > 0}
                    region="attachments"
                    className="px-1.5 pb-1 pt-2"
                  >
                    <div className="flex flex-wrap gap-2">
                      {stagedEntries.map(({ key, item, leaving }) => (
                        <div key={key} className={leaving ? 'mila-tile-out' : 'mila-tile-in'}>
                          <StagedFileTile staged={item} onRemove={() => removeStagedFile(item.id)} />
                        </div>
                      ))}
                    </div>
                  </ComposerCollapse>
                  <input
                    ref={attachmentInputRef}
                    type="file"
                    multiple
                    accept=".pdf,.docx,.pptx,.txt,.md,.markdown,.csv,.png,.jpg,.jpeg,.webp,.heic,.heif"
                    onChange={handleAttachmentFiles}
                    disabled={creating}
                    className="sr-only"
                  />
                  <textarea
                    ref={textareaRef}
                    rows={1}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onInput={handleTextareaInput}
                    onKeyDown={handleInputKeyDown}
                    placeholder={
                      modeSpec(generateMode)?.placeholder ?? 'Start a new chat about this batch…'
                    }
                    disabled={creating}
                    className={COMPOSER_TEXTAREA_CLASS}
                  />
                  <ComposerControls>
                    <ComposerAddMenu
                      menuRef={composerMenuRef}
                      open={composerMenuOpen}
                      onOpenChange={setComposerMenuOpen}
                      onAttach={() => {
                        setComposerMenuOpen(false)
                        attachmentInputRef.current?.click()
                      }}
                      attachDisabled={creating || stagedFiles.length >= 5}
                      disabled={creating}
                      onSelectMode={selectGenerateMode}
                    />
                    <WebSearchToggle
                      id="batch-chat-web-search"
                      checked={webSearch}
                      disabled={creating}
                      onChange={setWebSearch}
                    />
                    <ComposerModeChip mode={generateMode} onClear={() => setGenerateMode(null)} />
                    <ComposerSpacer />
                    <IconButton
                      variant="solid"
                      size="lg"
                      label="Start chat"
                      onClick={() => void handleStartChat()}
                      disabled={(!input.trim() && stagedFiles.length === 0) || creating}
                    >
                      {creating ? <Spinner tone="inverse" size={16} /> : <Send className="h-4 w-4" />}
                    </IconButton>
                  </ComposerControls>
                </ComposerSurface>
              </ComposerTint>
              <ComposerHint>Enter to start a new chat · Shift+Enter for new line</ComposerHint>
        </div>
      </div>
      </div>

    </div>
  )
}
