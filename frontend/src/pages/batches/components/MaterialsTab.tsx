import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type RefObject,
} from 'react'
import { useNavigate } from 'react-router-dom'
import type { BatchFile } from '../../../entity/File'
import type { Chat } from '../../../entity/Chat'
import axios from 'axios'
import {
  Check,
  Clock,
  FileText,
  MessageCircle,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Send,
  Trash2,
  Upload,
  X,
  BookOpenCheck,
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
import { BTN_PRIMARY, BTN_SECONDARY } from '../constants'
import { IndexStatusBadge } from './IndexStatusBadge'
import { getCurrentCourseBlueprint, type CourseBlueprint } from '../../../services/courseBlueprintService'
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
  onOpenPlanning: () => void
}

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

export function batchFileStatusLabel(file: BatchFile): string {
  if (file.overlay_status === 'ready' && file.index_status === 'failed') return 'Ready for immediate use · Durable indexing failed'
  if (file.overlay_status === 'failed' && ['pending', 'indexing'].includes(file.index_status)) return 'Immediate preview failed · Durable indexing running'
  if (file.overlay_status === 'retiring') return 'Indexed · Immediate overlay retained temporarily'
  if (file.overlay_status === 'ready') return 'Ready for immediate use · Indexing for durable search'
  return file.index_status === 'indexed' ? 'Indexed' : ''
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
  onOpenPlanning,
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
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [blueprint, setBlueprint] = useState<CourseBlueprint | null>(null)
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

  useEffect(() => { void getCurrentCourseBlueprint(batchId).then(setBlueprint).catch(() => setBlueprint(null)) }, [batchId])

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

  function openChat(chatId: string) {
    navigate(`/batches/${batchId}/chats/${chatId}`)
  }

  function startRename(chat: Chat) {
    setRenamingId(chat.chat_id)
    setRenameValue(chat.title)
    setMenuOpenId(null)
    setConfirmDeleteId(null)
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

  async function doDelete(chat: Chat) {
    await deleteChat(batchId, chat.chat_id)
    setChats((prev) => prev.filter((item) => item.chat_id !== chat.chat_id))
    setConfirmDeleteId(null)
    setMenuOpenId(null)
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {/* Columns share the same top edge; composer stays pinned below. */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto lg:grid-cols-[minmax(0,1fr)_20rem] lg:overflow-hidden lg:items-stretch">
        <section className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm lg:h-full">
          <div className="flex shrink-0 items-center gap-2 border-b border-slate-100 px-4 py-3">
            <MessageCircle className="h-4 w-4 text-violet-600" />
            <h3 className="text-sm font-semibold text-slate-700">Chat History</h3>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {chatsLoading ? (
              <div className="flex flex-col items-center justify-center gap-3 py-16">
                <Spinner size={24} />
                <p className="text-sm text-slate-500">Loading chats…</p>
              </div>
            ) : chats.length === 0 ? (
              <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
                <MessageCircle className="mb-2 h-8 w-8 text-slate-300" />
                <span className="text-sm font-medium text-slate-500">No chats yet.</span>
                <p className="mt-1 text-xs text-slate-400">
                  Start a conversation using the input below.
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-slate-100">
                {chats.map((chat) => (
                  <li key={chat.chat_id} className="relative group">
                    <div className="w-full px-4 py-3 text-left transition-colors hover:bg-violet-50/60">
                      <div className="flex items-start justify-between gap-3">
                        <div
                          className="min-w-0 flex-1 cursor-pointer"
                          onClick={() => {
                            if (renamingId === chat.chat_id) return
                            openChat(chat.chat_id)
                          }}
                        >
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
                              className="w-full border-b border-violet-400 bg-transparent text-sm font-medium text-slate-900 outline-none"
                              onClick={(e) => e.stopPropagation()}
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
                          <div
                            className={`relative flex items-center gap-0.5 transition-opacity ${
                              confirmDeleteId === chat.chat_id || menuOpenId === chat.chat_id
                                ? 'opacity-100'
                                : 'opacity-0 group-hover:opacity-100'
                            }`}
                            data-chat-menu
                          >
                            {confirmDeleteId === chat.chat_id ? (
                              <>
                                <button
                                  type="button"
                                  onClick={() => void doDelete(chat)}
                                  className="rounded p-1 text-red-500 hover:bg-red-50 hover:text-red-600"
                                  aria-label="Confirm delete chat"
                                >
                                  <Check className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeleteId(null)}
                                  className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                                  aria-label="Cancel delete chat"
                                >
                                  <X className="h-3.5 w-3.5" />
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setMenuOpenId((value) =>
                                      value === chat.chat_id ? null : chat.chat_id,
                                    )
                                  }
                                  className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                                  aria-label="Open chat actions"
                                >
                                  <MoreHorizontal className="h-3.5 w-3.5" />
                                </button>
                                {menuOpenId === chat.chat_id && (
                                  <div className="absolute right-0 top-7 z-20 w-32 rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
                                    <button
                                      type="button"
                                      onClick={() => startRename(chat)}
                                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                                    >
                                      <Pencil className="h-3.5 w-3.5" />
                                      Rename
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setConfirmDeleteId(chat.chat_id)
                                        setMenuOpenId(null)
                                      }}
                                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-red-500 hover:bg-red-50 hover:text-red-600"
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                      Delete
                                    </button>
                                  </div>
                                )}
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {hasMoreChats && !chatsLoading && chats.length > 0 && (
              <button
                type="button"
                onClick={() => void loadOlderChats()}
                disabled={loadingMoreChats}
                className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loadingMoreChats && <Spinner size={14} tone="muted" />}
                {loadingMoreChats ? 'Loading...' : 'Show older sessions'}
              </button>
            )}
          </div>
        </section>

        <aside className="flex min-h-0 min-w-0 flex-col gap-4 lg:h-full lg:overflow-y-auto">
          <div className="shrink-0 rounded-2xl border border-violet-200 bg-violet-50/70 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-violet-900">
              <BookOpenCheck className="h-4 w-4" />
              Course Blueprint
            </div>
            {blueprint ? (
              <>
                <p className="mt-2 text-sm font-medium text-slate-800">{blueprint.title}</p>
                <p className="mt-1 text-xs text-slate-500">
                  Version {blueprint.version} · {blueprint.weekly_plan.length} weeks planned
                </p>
                <p className="mt-1 text-xs text-slate-400">
                  Updated {formatDateTime(blueprint.updated_at || blueprint.created_at || '')}
                </p>
              </>
            ) : (
              <p className="mt-2 text-xs text-slate-600">No active planning memory yet.</p>
            )}
            <button
              type="button"
              onClick={onOpenPlanning}
              className={`${BTN_SECONDARY} mt-3 w-full`}
            >
              Open Blueprint
            </button>
          </div>

          <div className="shrink-0">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-700">
              <Upload className="h-4 w-4 text-violet-600" />
              Upload Materials
            </h3>
            <p className="mb-3 text-xs text-slate-500">
              PDFs, documents, and text files are indexed for AI search. Up to{' '}
              {MAX_COURSE_SPACE_FILES} files per space.
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.txt,.md,.docx,.json"
              onChange={onFileUpload}
              disabled={fileUploading || atFileLimit}
              className="sr-only"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={fileUploading || atFileLimit}
              className={`${BTN_PRIMARY} w-full justify-center`}
            >
              {fileUploading ? (
                <>
                  <Spinner size={16} />
                  Uploading…
                </>
              ) : (
                <>
                  <Upload className="h-4 w-4" />
                  Upload File
                </>
              )}
            </button>
            {atFileLimit && (
              <p className="mt-2 text-xs text-amber-600">
                {MAX_COURSE_SPACE_FILES}-file limit reached — remove a file to add another.
              </p>
            )}
          </div>

          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="mb-3 flex shrink-0 items-center justify-between gap-2">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                <FileText className="h-4 w-4 text-violet-600" />
                Uploaded Files
                {files.length > 0 && (
                  <span className="text-xs font-normal text-slate-400">
                    ({files.length} / {MAX_COURSE_SPACE_FILES})
                  </span>
                )}
              </h3>
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
            </div>
            <div className="min-h-[12rem] flex-1 overflow-y-auto rounded-2xl border border-slate-100 bg-white shadow-sm">
              {filesLoading && files.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-3 py-12">
                  <Spinner size={24} />
                  <p className="text-sm text-slate-500">Loading files…</p>
                </div>
              ) : files.length === 0 ? (
                <div className="flex flex-col items-center justify-center px-4 py-12 text-center">
                  <FileText className="mb-2 h-7 w-7 text-slate-300" />
                  <span className="text-sm font-medium text-slate-500">No files uploaded.</span>
                </div>
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
                            <p className="mt-1 text-xs font-medium text-slate-600">
                              {batchFileStatusLabel(f)}
                            </p>
                            {['uploading', 'pending', 'indexing', 'deleting'].includes(
                              f.index_status,
                            ) && (
                              <p className="mt-1 animate-pulse text-xs text-slate-500">
                                {f.index_message || 'Indexing in progress...'}
                              </p>
                            )}
                            {f.index_error && (
                              <p className="mt-1 break-words text-xs text-red-600">
                                {f.index_error}
                              </p>
                            )}
                            {f.overlay_warning && (
                              <p className="mt-1 break-words text-xs text-amber-700">
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

      <div className="shrink-0 border-t border-slate-200/80 pt-3">
        <div className="w-full max-w-3xl">
          {attachmentErrors.map((error) => (
            <p key={error} className="mb-1 text-xs text-red-600">
              {error}
            </p>
          ))}
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
  )
}
