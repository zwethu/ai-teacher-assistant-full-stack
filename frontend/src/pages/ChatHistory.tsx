import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import {
  MessageCircle,
  MoreHorizontal,
  Pencil,
  Trash2,
} from 'lucide-react'
import { invalidateSessionsCache, useAllSessions, type SessionItem } from '../hooks/useAllSessions'
import { deleteChat, updateChatTitle } from '../services/chatService'
import { confirm } from '../components/ui/confirmStore'
import { undoable, usePendingUndo } from '../components/ui/undoStore'
import { formatDateTime, timeAgo } from '../utils/formatDate'
import { Spinner } from '../design-system'

// Enough to decide whether the menu fits below its button before it is
// rendered — the list card clips anything drawn inside it, so the menu is
// portalled to the body and has to be placed by hand.
const MENU_HEIGHT = 76

export default function ChatHistory() {
  const navigate = useNavigate()
  const { sessions, loading, refresh } = useAllSessions()
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null)
  const [menuPos, setMenuPos] = useState({ top: 0, right: 0 })
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  // Sessions inside their undo window: hidden here, still on the server.
  const pendingUndo = usePendingUndo()
  const renameInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!menuOpenId) return

    function handleMouseDown(e: MouseEvent) {
      if (e.target instanceof Element && e.target.closest('[data-session-menu]')) return
      setMenuOpenId(null)
    }

    // The menu is positioned once, against the viewport. Scrolling or resizing
    // would leave it floating away from its row, so it closes instead.
    function dismiss() {
      setMenuOpenId(null)
    }

    document.addEventListener('mousedown', handleMouseDown)
    window.addEventListener('resize', dismiss)
    window.addEventListener('scroll', dismiss, true)
    return () => {
      document.removeEventListener('mousedown', handleMouseDown)
      window.removeEventListener('resize', dismiss)
      window.removeEventListener('scroll', dismiss, true)
    }
  }, [menuOpenId])

  function toggleMenu(chatId: string, anchor: HTMLElement) {
    if (menuOpenId === chatId) {
      setMenuOpenId(null)
      return
    }
    const rect = anchor.getBoundingClientRect()
    const flipUp = rect.bottom + MENU_HEIGHT > window.innerHeight
    setMenuPos({
      top: flipUp ? rect.top - MENU_HEIGHT - 4 : rect.bottom + 4,
      right: window.innerWidth - rect.right,
    })
    setMenuOpenId(chatId)
  }

  function startRename(session: SessionItem) {
    setRenamingId(session.chat_id)
    setRenameValue(session.title)
    setMenuOpenId(null)
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

  /* Ask, then hold — the same flow as every other delete in the app. The row
     used to swap its menu button for a tick and a cross, two small targets
     side by side where the left one deleted the conversation outright. */
  /* `sessions` itself is untouched, so undoing simply stops hiding one. */
  const visibleSessions = sessions.filter((session) => !pendingUndo.has(session.chat_id))

  async function handleDelete(session: SessionItem) {
    setMenuOpenId(null)
    const ok = await confirm({
      title: `Delete "${session.title}"?`,
      body: 'Every message in this conversation goes with it.',
      confirmLabel: 'Delete',
      tone: 'danger',
    })
    if (!ok) return

    undoable({
      id: session.chat_id,
      message: `Deleted "${session.title}".`,
      commit: async () => {
        try {
          await deleteChat(session.batch_id, session.chat_id)
          invalidateSessionsCache()
          await refresh(true)
        } catch (err) {
          console.error(err)
        }
      },
    })
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800 tracking-tight">Sessions</h1>
        <p className="text-sm text-slate-500 mt-1">
          Every chat across your batches, most recent first.
        </p>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <Spinner size={32} />
            <p className="text-sm text-slate-500">Loading sessions…</p>
          </div>
        ) : visibleSessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center px-6">
            <MessageCircle className="w-8 h-8 text-slate-300 mb-3" />
            <h3 className="text-sm font-medium text-slate-900">No sessions yet</h3>
            <p className="mt-1 text-sm text-slate-500">
              Start a chat from a batch to see your session history here.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {visibleSessions.map((chat) => (
              <li key={chat.chat_id} className="group relative">
                <div className="flex w-full items-center gap-3 px-5 py-3 transition-colors hover:bg-violet-50/50">
                  <div className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-lg bg-violet-50 text-violet-500 transition-colors group-hover:bg-violet-100">
                    <MessageCircle className="h-4 w-4" />
                  </div>

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
                      <div className="truncate text-sm font-medium text-slate-900">
                        {chat.title}
                      </div>
                    )}
                    <p className="truncate text-xs text-slate-400">
                      {chat.preview || 'No messages yet'}
                    </p>
                  </div>

                  {/* The list is no longer grouped by batch, so the batch rides
                      along on each row — kept in a quiet right-hand column so it
                      reads as metadata rather than competing with the title. */}
                  <div className="hidden flex-shrink-0 items-center gap-3 sm:flex">
                    <span className="max-w-[9rem] truncate rounded-md bg-slate-50 px-2 py-1 text-[11px] font-medium text-slate-500 ring-1 ring-inset ring-slate-200/80">
                      {chat.batch_name}
                    </span>
                    <span
                      className="w-24 text-right text-xs text-slate-400"
                      title={chat.updated_at ? formatDateTime(chat.updated_at) : undefined}
                    >
                      {chat.updated_at ? timeAgo(chat.updated_at) : '—'}
                    </span>
                  </div>

                  <div className="flex flex-shrink-0 items-center gap-0.5" data-session-menu>
                    <>
                        <button
                          type="button"
                          onClick={(e) => toggleMenu(chat.chat_id, e.currentTarget)}
                          className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                          aria-label="Open session actions"
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </button>
                        {menuOpenId === chat.chat_id &&
                          createPortal(
                            <div
                              data-session-menu
                              style={{ top: menuPos.top, right: menuPos.right }}
                              className="fixed z-50 w-32 rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
                            >
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
                                onClick={() => void handleDelete(chat)}
                                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-red-500 hover:bg-red-50 hover:text-red-600"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                                Delete
                              </button>
                            </div>,
                            document.body,
                          )}
                    </>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
