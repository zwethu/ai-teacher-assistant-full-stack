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
import {
  Check,
  Clock,
  FileText,
  Loader2,
  MessageCircle,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Trash2,
  Upload,
  X,
  BookOpenCheck,
} from 'lucide-react'
import {
  createChat,
  deleteChat,
  listChats,
  listMessages,
  updateChatTitle,
} from '../../../services/chatService'
import { formatDateTime } from '../../../utils/formatDate'
import { emitChatCreated } from '../../../utils/chatEvents'
import { BTN_PRIMARY } from '../constants'
import { IndexStatusBadge } from './IndexStatusBadge'
import { getCurrentCourseBlueprint, type CourseBlueprint } from '../../../services/courseBlueprintService'

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

type ChatWithPreview = Chat & { preview: string }

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
  const navigate = useNavigate()
  const [chats, setChats] = useState<ChatWithPreview[]>([])
  const [chatsLoading, setChatsLoading] = useState(true)
  const [input, setInput] = useState('')
  const [creating, setCreating] = useState(false)
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [blueprint, setBlueprint] = useState<CourseBlueprint | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const renameInputRef = useRef<HTMLInputElement>(null)

  const loadChats = useCallback(async () => {
    setChatsLoading(true)
    try {
      const data = await listChats(batchId)
      const withPreviews = await Promise.all(
        data.map(async (chat) => {
          try {
            const messages = await listMessages(batchId, chat.chat_id)
            const firstUser = messages.find((m) => m.role === 'user')
            return { ...chat, preview: firstUser?.content?.slice(0, 120) ?? '' }
          } catch {
            return { ...chat, preview: '' }
          }
        }),
      )
      setChats(withPreviews)
    } catch (err) {
      console.error(err)
      setChats([])
    } finally {
      setChatsLoading(false)
    }
  }, [batchId])

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

  function handleTextareaInput() {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }

  function handleInputKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void handleStartChat()
    }
  }

  async function handleStartChat() {
    const content = input.trim()
    if (!content || creating) return

    setCreating(true)
    try {
      const title = content.slice(0, 50) || 'New Chat'
      const chat = await createChat(batchId, title)
      emitChatCreated()
      setInput('')
      navigate(`/batches/${batchId}/chats/${chat.chat_id}`, {
        state: { initialMessage: content },
      })
    } catch (err) {
      console.error(err)
    } finally {
      setCreating(false)
    }
  }

  function openChat(chatId: string) {
    navigate(`/batches/${batchId}/chats/${chatId}`)
  }

  function startRename(chat: ChatWithPreview) {
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

  async function doDelete(chat: ChatWithPreview) {
    await deleteChat(batchId, chat.chat_id)
    setChats((prev) => prev.filter((item) => item.chat_id !== chat.chat_id))
    setConfirmDeleteId(null)
    setMenuOpenId(null)
  }

  return (
    <div className="flex flex-col min-h-[560px]">
      <div className="flex flex-1 min-h-0 gap-6">
        <div className="flex-1 min-w-0 flex flex-col min-h-0">
          <h3 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
            <MessageCircle className="w-4 h-4 text-emerald-600" />
            Chat History
          </h3>
          <div className="flex-1 overflow-y-auto bg-white rounded-2xl shadow-sm border border-slate-100">
            {chatsLoading ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3">
                <Loader2 className="w-6 h-6 text-emerald-600 animate-spin" />
                <p className="text-sm text-slate-500">Loading chats…</p>
              </div>
            ) : chats.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center px-6">
                <MessageCircle className="w-8 h-8 text-slate-300 mb-2" />
                <span className="text-sm font-medium text-slate-500">No chats yet.</span>
                <p className="text-xs text-slate-400 mt-1">
                  Start a conversation using the input below.
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-slate-100">
                {chats.map((chat) => (
                  <li key={chat.chat_id} className="relative group">
                    <div
                      className="w-full text-left px-4 py-3 hover:bg-emerald-50/60 transition-colors"
                    >
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
                              className="w-full bg-transparent text-sm font-medium text-slate-900 outline-none border-b border-emerald-400"
                              onClick={(e) => e.stopPropagation()}
                            />
                          ) : (
                            <div className="text-sm font-medium text-slate-900 truncate">
                              {chat.title}
                            </div>
                          )}
                          {chat.preview && renamingId !== chat.chat_id && (
                            <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">
                              {chat.preview}
                            </p>
                          )}
                        </div>
                        <div className="flex items-start gap-2 flex-shrink-0">
                          <span className="text-xs text-slate-400 whitespace-nowrap">
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
                                  onClick={() => setMenuOpenId((value) => (
                                    value === chat.chat_id ? null : chat.chat_id
                                  ))}
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
          </div>
        </div>

        <div className="w-80 flex-shrink-0 flex flex-col min-h-0 gap-4">
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-emerald-900"><BookOpenCheck className="h-4 w-4"/>Course Blueprint</div>
            {blueprint ? <><p className="mt-2 text-sm font-medium text-slate-800">{blueprint.title}</p><p className="mt-1 text-xs text-slate-500">Version {blueprint.version} · {blueprint.weekly_plan.length} weeks planned</p><p className="mt-1 text-xs text-slate-400">Updated {formatDateTime(blueprint.updated_at || blueprint.created_at || '')}</p></> : <p className="mt-2 text-xs text-slate-600">No active planning memory yet.</p>}
            <button onClick={onOpenPlanning} className="mt-3 w-full rounded-lg border border-emerald-300 bg-white px-3 py-2 text-sm font-medium text-emerald-800">Open Blueprint</button>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
              <Upload className="w-4 h-4 text-emerald-600" />
              Upload Materials
            </h3>
            <p className="text-xs text-slate-500 mb-3">
              PDFs, documents, and text files are indexed for AI search.
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.txt,.md,.docx,.json"
              onChange={onFileUpload}
              disabled={fileUploading}
              className="sr-only"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={fileUploading}
              className={`${BTN_PRIMARY} w-full justify-center`}
            >
              {fileUploading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Uploading…
                </>
              ) : (
                <>
                  <Upload className="w-4 h-4" />
                  Upload File
                </>
              )}
            </button>
          </div>

          <div className="flex-1 min-h-0 flex flex-col">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                <FileText className="w-4 h-4 text-emerald-600" />
                Uploaded Files
                {files.length > 0 && (
                  <span className="text-xs font-normal text-slate-400">({files.length})</span>
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
                <RefreshCw className={`w-4 h-4 ${filesLoading ? 'animate-spin' : ''}`} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto bg-white rounded-2xl shadow-sm border border-slate-100">
              {filesLoading && files.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 gap-3">
                  <Loader2 className="w-6 h-6 text-emerald-600 animate-spin" />
                  <p className="text-sm text-slate-500">Loading files…</p>
                </div>
              ) : files.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center px-4">
                  <FileText className="w-7 h-7 text-slate-300 mb-2" />
                  <span className="text-sm font-medium text-slate-500">No files uploaded.</span>
                </div>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {files.map((f) => (
                    <li key={f.file_id} className="px-4 py-3 hover:bg-slate-50/80 transition-colors">
                      <div className="flex items-start gap-2">
                        <FileText className="w-4 h-4 text-slate-400 flex-shrink-0 mt-0.5" />
                        <div className="min-w-0 flex-1">
                          <div
                            className="text-sm font-medium text-slate-900 truncate"
                            title={f.file_name}
                          >
                            {f.file_title || f.file_name}
                          </div>
                          <div className="mt-1">
                            <IndexStatusBadge status={f.index_status} />
                            {['uploading', 'indexing', 'deleting'].includes(f.index_status) && (
                              <p className="text-xs text-slate-500 mt-1 animate-pulse">
                                {f.index_message || 'Indexing in progress...'}
                              </p>
                            )}
                            {f.index_error && (
                              <p className="text-xs text-red-600 mt-1 break-words">
                                {f.index_error}
                              </p>
                            )}
                          </div>
                          {f.created_at && (
                            <span className="flex items-center gap-1 text-xs text-slate-400 mt-1">
                              <Clock className="w-3 h-3" />
                              {formatDateTime(new Date(f.created_at))}
                            </span>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => onDeleteFile(f)}
                          disabled={f.index_status === 'deleting'}
                          className="p-1.5 rounded-md text-slate-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-50 transition-colors flex-shrink-0"
                          aria-label="Delete file"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="flex-shrink-0 pt-4 mt-4 border-t border-slate-200/80">
        <div className="max-w-3xl">
          <div className="flex items-end gap-2 p-2 rounded-[28px] bg-white/55 border border-white/60 shadow-[0_8px_32px_rgba(15,23,42,0.08)]">
            <textarea
              ref={textareaRef}
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onInput={handleTextareaInput}
              onKeyDown={handleInputKeyDown}
              placeholder="Start a new chat about this batch…"
              disabled={creating}
              className="flex-1 resize-none bg-transparent px-4 py-3 text-[15px] text-slate-800 placeholder:text-slate-400 focus:outline-none disabled:cursor-not-allowed max-h-40 overflow-y-auto leading-6"
            />
            <button
              type="button"
              onClick={() => void handleStartChat()}
              disabled={!input.trim() || creating}
              className="flex-shrink-0 inline-flex items-center justify-center w-10 h-10 mb-0.5 mr-1 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white shadow-md shadow-emerald-600/25 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              aria-label="Start chat"
            >
              {creating ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <MessageCircle className="w-4 h-4" />
              )}
            </button>
          </div>
          <p className="mt-2 text-xs text-slate-400">
            Enter to start a new chat · Shift+Enter for new line
          </p>
        </div>
      </div>
    </div>
  )
}
