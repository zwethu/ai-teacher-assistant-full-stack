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

  const rowClass = isActive
    ? 'bg-gradient-to-r from-emerald-100 to-white border-emerald-300 text-emerald-800 shadow-md'
    : 'border-transparent text-slate-600 hover:text-slate-900 hover:bg-gradient-to-r hover:from-white hover:via-emerald-50/60 hover:to-white hover:border-slate-200 hover:shadow-sm'

  if (collapsed) {
    return (
      <>
        <button
          ref={iconRef}
          type="button"
          onClick={goToHistory}
          onMouseEnter={showPreview}
          onMouseLeave={scheduleHidePreview}
          className={`flex items-center justify-center w-10 h-10 mx-auto rounded-xl border transition-all ${
            isActive
              ? 'bg-emerald-100/90 border-emerald-300 text-emerald-700 shadow-md'
              : 'border-transparent text-slate-500 hover:text-emerald-600 hover:bg-emerald-50/60 hover:border-slate-200'
          }`}
          title="Sessions"
          aria-label="Go to sessions"
        >
          <Clock className="w-5 h-5" />
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

  const showChevron = hovering || inlineOpen

  return (
    <div
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
    >
      <div className={`group flex items-center w-full rounded-xl border transition-all ${rowClass}`}>
        <button
          type="button"
          onClick={goToHistory}
          className="flex flex-1 items-center gap-3 px-3 py-2.5 min-w-0 text-sm font-medium rounded-l-xl"
        >
          <Clock
            className={`w-5 h-5 flex-shrink-0 ${isActive ? 'text-emerald-700' : 'text-slate-500 group-hover:text-emerald-600'}`}
          />
          <span className="truncate text-left">Sessions</span>
        </button>

        <button
          type="button"
          onClick={toggleInline}
          className={`flex-shrink-0 px-2 py-2.5 rounded-r-xl text-slate-400 hover:text-emerald-600 hover:bg-emerald-50/40 transition-all ${
            showChevron ? 'opacity-100 w-8' : 'opacity-0 w-0 px-0 overflow-hidden pointer-events-none'
          }`}
          aria-label={inlineOpen ? 'Collapse recent sessions' : 'Expand recent sessions'}
          aria-expanded={inlineOpen}
        >
          <ChevronRight
            className={`w-4 h-4 transition-transform duration-200 ${inlineOpen ? 'rotate-90' : ''}`}
          />
        </button>
      </div>

      {inlineOpen && (
        <div className="mt-0.5 ml-1 mr-1 rounded-lg border border-slate-100 bg-white/60 overflow-hidden">
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
