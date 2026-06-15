import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation, useNavigate } from 'react-router-dom'
import { ChevronRight, Clock, Loader2 } from 'lucide-react'
import { useAllSessions, type SessionItem } from '../../hooks/useAllSessions'

type Props = {
  showLabels: boolean
  collapsed: boolean
  onNavigate?: () => void
}

function sessionsExpandedClass(isActive: boolean): string {
  const layout = 'gap-3 px-3 py-2.5 w-full'
  if (isActive) {
    return `relative flex items-center ${layout} text-sm font-medium rounded-xl whitespace-nowrap group text-emerald-800 bg-gradient-to-r from-emerald-100 to-white border border-emerald-300 shadow-md -translate-y-0.5 transition-all`
  }
  return `flex items-center ${layout} text-sm font-medium rounded-xl whitespace-nowrap group text-slate-600 hover:text-slate-900 hover:bg-gradient-to-r hover:from-white hover:via-emerald-50/60 hover:to-white border border-transparent hover:border-slate-200 hover:shadow-sm hover:-translate-y-0.5 transition-all`
}

function sessionsCollapsedClass(isActive: boolean): string {
  const layout = 'justify-center items-center p-2 w-10 h-10 mx-auto shrink-0'
  if (isActive) {
    return `relative flex ${layout} text-sm font-medium rounded-xl group text-emerald-800 bg-emerald-100/90 border border-emerald-300 shadow-md -translate-y-0.5 transition-all`
  }
  return `flex ${layout} text-sm font-medium rounded-xl group text-slate-600 hover:text-slate-900 hover:bg-gradient-to-r hover:from-white hover:via-emerald-50/60 hover:to-white border border-transparent hover:border-slate-200 hover:shadow-sm hover:-translate-y-0.5 transition-all`
}

function iconClass(isActive: boolean): string {
  return isActive
    ? 'text-emerald-700'
    : 'text-slate-500 group-hover:text-emerald-600'
}

function SessionList({
  sessions,
  loading,
  limit,
  onSelect,
  compact = false,
}: {
  sessions: SessionItem[]
  loading: boolean
  limit: number
  onSelect: (session: SessionItem) => void
  compact?: boolean
}) {
  const items = sessions.slice(0, limit)

  if (loading && items.length === 0) {
    return (
      <div className="flex items-center justify-center py-4">
        <Loader2 className="w-4 h-4 text-emerald-600 animate-spin" />
      </div>
    )
  }

  if (items.length === 0) {
    return <p className="px-3 py-3 text-xs text-slate-500">No sessions yet.</p>
  }

  if (compact) {
    return (
      <ul className="py-0.5">
        {items.map((session) => (
          <li key={`${session.batch_id}-${session.chat_id}`}>
            <button
              type="button"
              onClick={() => onSelect(session)}
              className="w-full text-left px-3 py-1.5 text-sm text-slate-600 hover:bg-emerald-50/60 hover:text-slate-900 transition-colors truncate"
              title={session.title}
            >
              {session.title}
            </button>
          </li>
        ))}
      </ul>
    )
  }

  return (
    <ul className="py-1">
      {items.map((session) => (
        <li key={`${session.batch_id}-${session.chat_id}`}>
          <button
            type="button"
            onClick={() => onSelect(session)}
            className="w-full text-left px-3 py-2 hover:bg-emerald-50/60 transition-colors"
          >
            <div className="text-sm font-medium text-slate-800 truncate">{session.title}</div>
            <div className="text-xs text-slate-500 truncate">{session.batch_name}</div>
          </button>
        </li>
      ))}
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
  const { sessions, loading } = useAllSessions()

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
    navigate('/chat', {
      state: { batchId: session.batch_id, chatId: session.chat_id },
    })
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
          <Clock className={`w-5 h-5 flex-shrink-0 ${iconClass(isActive)}`} />
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
      <div className={sessionsExpandedClass(isActive)}>
        <button
          type="button"
          onClick={toggleInline}
          className="flex-shrink-0 rounded-md hover:bg-emerald-50/50 transition-colors"
          aria-label={inlineOpen ? 'Collapse sessions' : 'Expand sessions'}
          aria-expanded={inlineOpen}
        >
          {showArrow ? (
            <ChevronRight
              className={`w-5 h-5 flex-shrink-0 transition-transform duration-200 ${iconClass(isActive)} ${inlineOpen ? 'rotate-90' : ''}`}
            />
          ) : (
            <Clock className={`w-5 h-5 flex-shrink-0 ${iconClass(isActive)}`} />
          )}
        </button>

        <button
          type="button"
          onClick={goToHistory}
          className="flex-1 min-w-0 text-left truncate sidebar-text"
        >
          Sessions
        </button>
      </div>

      {inlineOpen && (
        <div className="mt-0.5 ml-3 mr-1 rounded-lg border border-slate-100 bg-white/60 overflow-hidden">
          <SessionList
            sessions={sessions}
            loading={loading}
            limit={10}
            onSelect={openChat}
            compact
          />
        </div>
      )}
    </div>
  )
}
