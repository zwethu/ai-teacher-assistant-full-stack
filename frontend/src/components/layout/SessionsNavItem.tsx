import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  Check,
  ChevronRight,
  History,
  MoreHorizontal,
  Pencil,
  Trash2,
  X,
} from 'lucide-react'
import { invalidateSessionsCache, useAllSessions, type SessionItem } from '../../hooks/useAllSessions'
import { deleteChat, updateChatTitle } from '../../services/chatService'
import { Spinner } from '../../design-system'

type Props = {
  showLabels: boolean
  collapsed: boolean
  onNavigate?: () => void
}

function sessionsExpandedClass(isActive: boolean): string {
  const layout = 'gap-3 px-3 py-2.5 w-full'
  if (isActive) {
    return `relative flex items-center ${layout} text-sm font-medium rounded-xl whitespace-nowrap group text-violet-800 bg-gradient-to-r from-violet-100 to-white border border-violet-300 shadow-md -translate-y-0.5 transition-all`
  }
  return `flex items-center ${layout} text-sm font-medium rounded-xl whitespace-nowrap group text-slate-600 hover:text-slate-900 hover:bg-gradient-to-r hover:from-white hover:via-violet-50/60 hover:to-white border border-transparent hover:border-slate-200 hover:shadow-sm hover:-translate-y-0.5 transition-all`
}

function sessionsCollapsedClass(isActive: boolean): string {
  const layout = 'justify-center items-center p-2 w-10 h-10 mx-auto shrink-0'
  if (isActive) {
    return `relative flex ${layout} text-sm font-medium rounded-xl group text-violet-800 bg-violet-100/90 border border-violet-300 shadow-md -translate-y-0.5 transition-all`
  }
  return `flex ${layout} text-sm font-medium rounded-xl group text-slate-600 hover:text-slate-900 hover:bg-gradient-to-r hover:from-white hover:via-violet-50/60 hover:to-white border border-transparent hover:border-slate-200 hover:shadow-sm hover:-translate-y-0.5 transition-all`
}

function iconClass(isActive: boolean): string {
  return isActive
    ? 'text-violet-700'
    : 'text-slate-500 group-hover:text-violet-600'
}

function SessionList({
  sessions,
  loading,
  limit,
  onSelect,
  onChanged,
  onDeleted,
  compact = false,
}: {
  sessions: SessionItem[]
  loading: boolean
  limit: number
  onSelect: (session: SessionItem) => void
  onChanged: () => void
  onDeleted?: (session: SessionItem) => void
  compact?: boolean
}) {
  const items = sessions.slice(0, limit)
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
    await updateChatTitle(session.batch_id, session.chat_id, title)
    invalidateSessionsCache()
    cancelRename()
    onChanged()
  }

  async function doDelete(session: SessionItem) {
    await deleteChat(session.batch_id, session.chat_id)
    invalidateSessionsCache()
    setConfirmDeleteId(null)
    setMenuOpenId(null)
    onDeleted?.(session)
    onChanged()
  }

  function renderRow(session: SessionItem, isCompact: boolean) {
    const isRenaming = renamingId === session.chat_id
    const isConfirming = confirmDeleteId === session.chat_id
    const isMenuOpen = menuOpenId === session.chat_id
    const rowPadding = isCompact ? 'px-3 py-1.5' : 'px-3 py-2'

    return (
      <li key={`${session.batch_id}-${session.chat_id}`} className="group relative">
        <div className={`flex items-center gap-2 ${rowPadding} hover:bg-violet-50/60 transition-colors`}>
          <div
            className="min-w-0 flex-1 cursor-pointer"
            onClick={() => {
              if (!isRenaming) onSelect(session)
            }}
          >
            {isRenaming ? (
              <input
                ref={renameInputRef}
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onBlur={() => void commitRename(session)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void commitRename(session)
                  if (e.key === 'Escape') cancelRename()
                }}
                className="w-full bg-transparent text-sm font-medium text-slate-800 outline-none border-b border-violet-400"
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <>
                <div className={`${isCompact ? 'font-normal text-slate-600' : 'font-medium text-slate-800'} text-sm truncate`}>
                  {session.title}
                </div>
                {!isCompact && (
                  <div className="text-xs text-slate-500 truncate">{session.batch_name}</div>
                )}
              </>
            )}
          </div>

          <div
            className={`relative flex flex-shrink-0 items-center gap-0.5 transition-opacity ${
              isConfirming || isMenuOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
            }`}
            data-session-menu
          >
            {isConfirming ? (
              <>
                <button
                  type="button"
                  onClick={() => void doDelete(session)}
                  className="rounded p-1 text-red-500 hover:bg-red-50 hover:text-red-600"
                  aria-label="Confirm delete session"
                >
                  <Check className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDeleteId(null)}
                  className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                  aria-label="Cancel delete session"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => setMenuOpenId((value) => (value === session.chat_id ? null : session.chat_id))}
                  className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                  aria-label="Open session actions"
                >
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </button>
                {isMenuOpen && (
                  <div className="absolute right-0 top-7 z-30 w-32 rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
                    <button
                      type="button"
                      onClick={() => startRename(session)}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      Rename
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setConfirmDeleteId(session.chat_id)
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
      </li>
    )
  }

  if (loading && items.length === 0) {
    return (
      <div className="flex items-center justify-center py-4">
        <Spinner size={16} />
      </div>
    )
  }

  if (items.length === 0) {
    return <p className="px-3 py-3 text-xs text-slate-500">No sessions yet.</p>
  }

  if (compact) {
    return (
      <ul className="py-0.5">
        {items.map((session) => renderRow(session, true))}
      </ul>
    )
  }

  return (
    <ul className="py-1">
      {items.map((session) => renderRow(session, false))}
    </ul>
  )
}

export function SessionsNavItem({ collapsed, onNavigate }: Props) {
  const navigate = useNavigate()
  const location = useLocation()
  const [hovering, setHovering] = useState(false)
  const [inlineOpen, setInlineOpen] = useState(false)
  const [previewVisible, setPreviewVisible] = useState(false)
  const [previewPos, setPreviewPos] = useState({ top: 0, left: 0 })
  const iconRef = useRef<HTMLButtonElement>(null)
  const previewRef = useRef<HTMLDivElement>(null)
  const hidePreviewTimer = useRef<number | null>(null)
  const { sessions, loading, refresh } = useAllSessions()

  const isActive = location.pathname === '/chat-history'

  const updatePreviewPosition = useCallback(() => {
    const el = iconRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    setPreviewPos({ top: rect.top, left: rect.right + 8 })
  }, [])

  function clearHidePreviewTimer() {
    if (hidePreviewTimer.current !== null) {
      window.clearTimeout(hidePreviewTimer.current)
      hidePreviewTimer.current = null
    }
  }

  function showPreview() {
    clearHidePreviewTimer()
    updatePreviewPosition()
    setPreviewVisible(true)
  }

  function scheduleHidePreview() {
    clearHidePreviewTimer()
    hidePreviewTimer.current = window.setTimeout(() => {
      setPreviewVisible(false)
    }, 120)
  }

  function goToHistory() {
    setInlineOpen(false)
    setPreviewVisible(false)
    onNavigate?.()
    navigate('/chat-history')
  }

  function openChat(session: SessionItem) {
    setInlineOpen(false)
    setPreviewVisible(false)
    onNavigate?.()
    navigate(`/batches/${session.batch_id}/chats/${session.chat_id}`)
  }

  function handleDeletedSession(session: SessionItem) {
    if (location.pathname === `/batches/${session.batch_id}/chats/${session.chat_id}`) {
      navigate('/chat')
    }
  }

  function toggleInline(e: React.MouseEvent) {
    e.stopPropagation()
    setInlineOpen((v) => !v)
  }

  useEffect(() => {
    return () => clearHidePreviewTimer()
  }, [])

  useEffect(() => {
    if (!previewVisible || !collapsed) return undefined

    function handleReposition() {
      updatePreviewPosition()
    }

    window.addEventListener('resize', handleReposition)
    window.addEventListener('scroll', handleReposition, true)
    return () => {
      window.removeEventListener('resize', handleReposition)
      window.removeEventListener('scroll', handleReposition, true)
    }
  }, [previewVisible, collapsed, updatePreviewPosition])

  if (collapsed) {
    return (
      <>
        <button
          ref={iconRef}
          type="button"
          onClick={goToHistory}
          onMouseEnter={showPreview}
          onMouseLeave={scheduleHidePreview}
          className={sessionsCollapsedClass(isActive)}
          title="Sessions"
          aria-label="Go to sessions"
        >
          <History className={`w-5 h-5 flex-shrink-0 ${iconClass(isActive)}`} />
        </button>

        {previewVisible &&
          createPortal(
            <div
              ref={previewRef}
              className="fixed z-[200] w-64 max-h-80 rounded-xl border border-slate-200 bg-white shadow-xl overflow-hidden flex flex-col"
              style={{ top: previewPos.top, left: previewPos.left }}
              onMouseEnter={showPreview}
              onMouseLeave={scheduleHidePreview}
            >
              <div className="px-3 py-2 border-b border-slate-100 bg-slate-50/80 flex-shrink-0">
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Sessions
                </span>
              </div>
              <div className="overflow-y-auto flex-1">
                <SessionList
                  sessions={sessions}
                  loading={loading}
                  limit={8}
                  onSelect={openChat}
                  onChanged={() => void refresh(true)}
                  onDeleted={handleDeletedSession}
                  compact
                />
              </div>
            </div>,
            document.body,
          )}
      </>
    )
  }

  const showArrow = hovering || inlineOpen

  return (
    <div
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
    >
      {/* The row keeps its identity icon at all times, like every other nav
          item; the disclosure arrow sits on the trailing edge where it reads as
          "there is more under this" rather than replacing what the row is. */}
      <div className={sessionsExpandedClass(isActive)}>
        <button
          type="button"
          onClick={goToHistory}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          <History className={`w-5 h-5 flex-shrink-0 ${iconClass(isActive)}`} />
          <span className="truncate sidebar-text">Sessions</span>
        </button>

        <button
          type="button"
          onClick={toggleInline}
          className={`flex-shrink-0 rounded-md p-0.5 transition-opacity hover:bg-violet-50/50 focus-visible:opacity-100 ${
            showArrow ? 'opacity-100' : 'opacity-0'
          }`}
          aria-label={inlineOpen ? 'Collapse sessions' : 'Expand sessions'}
          aria-expanded={inlineOpen}
        >
          <ChevronRight
            className={`w-4 h-4 flex-shrink-0 transition-transform duration-200 ${iconClass(isActive)} ${inlineOpen ? 'rotate-90' : ''}`}
          />
        </button>
      </div>

      {inlineOpen && (
        <div className="mt-0.5 ml-3 mr-1 rounded-lg border border-slate-100 bg-white/60 overflow-hidden">
          <SessionList
            sessions={sessions}
            loading={loading}
            limit={10}
            onSelect={openChat}
            onChanged={() => void refresh(true)}
            onDeleted={handleDeletedSession}
            compact
          />
        </div>
      )}
    </div>
  )
}
