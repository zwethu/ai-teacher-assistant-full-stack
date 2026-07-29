import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Check,
  MessageCircle,
  MoreHorizontal,
  Pencil,
  Trash2,
  X,
} from 'lucide-react'
import { invalidateSessionsCache, useAllSessions, type SessionItem } from '../hooks/useAllSessions'
import { deleteChat, updateChatTitle } from '../services/chatService'
import { formatDateTime } from '../utils/formatDate'
import { Spinner } from '../design-system'

export default function ChatHistory() {
  const navigate = useNavigate()
  const { sessions, loading, refresh } = useAllSessions({ includePreviews: true })
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const renameInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!menuOpenId) return

    function handleMouseDown(e: MouseEvent) {
      if (e.target instanceof Element && e.target.closest('[data-session-menu]')) return
      setMenuOpenId(null)
    }

    document.addEventListener('mousedown', handleMouseDown)
    return () => document.removeEventListener('mousedown', handleMouseDown)
  }, [menuOpenId])

  function startRename(session: SessionItem) {
    setRenamingId(session.chat_id)
    setRenameValue(session.title)
    setMenuOpenId(null)
    setConfirmDeleteId(null)
    setTimeout(() => renameInputRef.current?.focus(), 50)
  }

  function cancelRename() {
    setRenamingId(null)
    setRenameValue('')
  }

  async function commitRename(session: SessionItem) {
    const title = renameValue.trim()
    if (!title) {
      cancelRename()
      return
    }
    try {
      await updateChatTitle(session.batch_id, session.chat_id, title)
      invalidateSessionsCache()
      cancelRename()
      await refresh(true)
    } catch (err) {
      console.error(err)
    }
  }

  async function doDelete(session: SessionItem) {
    try {
      await deleteChat(session.batch_id, session.chat_id)
      invalidateSessionsCache()
      setConfirmDeleteId(null)
      setMenuOpenId(null)
      await refresh(true)
    } catch (err) {
      console.error(err)
    }
  }

  const grouped = sessions.reduce<
    Record<string, { batch_name: string; chats: typeof sessions }>
  >((acc, session) => {
    if (!acc[session.batch_id]) {
      acc[session.batch_id] = { batch_name: session.batch_name, chats: [] }
    }
    acc[session.batch_id].chats.push(session)
    return acc
  }, {})

  const batchGroups = Object.entries(grouped)

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800 tracking-tight">Sessions</h1>
        <p className="text-sm text-slate-500 mt-1">
          All chat sessions across your batches.
        </p>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <Spinner size={32} />
            <p className="text-sm text-slate-500">Loading sessions…</p>
          </div>
        ) : sessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center px-6">
            <MessageCircle className="w-8 h-8 text-slate-300 mb-3" />
            <h3 className="text-sm font-medium text-slate-900">No sessions yet</h3>
            <p className="mt-1 text-sm text-slate-500">
              Start a chat from a batch to see your session history here.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {batchGroups.map(([batchId, group]) => (
              <section key={batchId}>
                <div className="px-6 py-3 bg-slate-50/90 border-b border-slate-100">
                  <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    {group.batch_name}
                  </h2>
                </div>
                <ul className="divide-y divide-slate-50">
                  {group.chats.map((chat) => (
                    <li key={chat.chat_id} className="group relative">
                      <div className="w-full px-6 py-4 hover:bg-violet-50/60 transition-colors">
                        <div className="flex items-start justify-between gap-4">
                          <div
                            className="min-w-0 flex-1 cursor-pointer"
                            onClick={() => {
                              if (renamingId !== chat.chat_id) {
                                navigate(`/batches/${chat.batch_id}/chats/${chat.chat_id}`)
                              }
                            }}
                          >
                            {renamingId === chat.chat_id ? (
                              <input
                                ref={renameInputRef}
                                value={renameValue}
                                onChange={(e) => setRenameValue(e.target.value)}
                                onBlur={() => void commitRename(chat)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') void commitRename(chat)
                                  if (e.key === 'Escape') cancelRename()
                                }}
                                className="w-full bg-transparent text-sm font-medium text-slate-900 outline-none border-b border-violet-400"
                                onClick={(e) => e.stopPropagation()}
                              />
                            ) : (
                              <div className="text-sm font-medium text-slate-900 truncate">
                                {chat.title}
                              </div>
                            )}
                            {chat.preview && renamingId !== chat.chat_id && (
                              <p className="text-xs text-slate-500 mt-1 line-clamp-2">
                                {chat.preview}
                              </p>
                            )}
                          </div>
                          <div className="flex flex-shrink-0 items-start gap-2">
                            <span className="text-xs text-slate-400 whitespace-nowrap">
                              {chat.updated_at ? formatDateTime(chat.updated_at) : '—'}
                            </span>
                            <div
                              className={`relative flex items-center gap-0.5 transition-opacity ${
                                confirmDeleteId === chat.chat_id || menuOpenId === chat.chat_id
                                  ? 'opacity-100'
                                  : 'opacity-0 group-hover:opacity-100'
                              }`}
                              data-session-menu
                            >
                              {confirmDeleteId === chat.chat_id ? (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => void doDelete(chat)}
                                    className="rounded p-1 text-red-500 hover:bg-red-50 hover:text-red-600"
                                    aria-label="Confirm delete session"
                                  >
                                    <Check className="h-4 w-4" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setConfirmDeleteId(null)}
                                    className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                                    aria-label="Cancel delete session"
                                  >
                                    <X className="h-4 w-4" />
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
                                    aria-label="Open session actions"
                                  >
                                    <MoreHorizontal className="h-4 w-4" />
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
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
