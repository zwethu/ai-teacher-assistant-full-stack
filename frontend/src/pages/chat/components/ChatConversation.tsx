import { useState, type RefObject } from 'react'
import type { KeyboardEvent } from 'react'
import type { ChatMessage } from '../../../entity/Chat'
import { BookOpen, FlaskConical, Loader2, Send, Sparkles, X } from 'lucide-react'
import { MessageRow, ThinkingIndicator } from './MessageRow'
import { ConnectorToggles, type ConnectorsState } from './ConnectorToggles'
import type { RunUiState } from '../runTypes'

type Props = {
  input: string
  sending: boolean
  disabled?: boolean
  dimmed?: boolean
  textareaRef: RefObject<HTMLTextAreaElement | null>
  onInputChange: (value: string) => void
  onInputKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => void
  onTextareaInput: () => void
  onSend: () => void
  connectors: ConnectorsState
  onConnectorsChange: (key: keyof ConnectorsState, value: boolean) => void
  onGeneratePreview: (input: {
    artifactType: 'lesson_plan' | 'lab'
    week: number
    topic: string
  }) => void
}

export function ChatInput({
  input,
  sending,
  disabled = false,
  dimmed = false,
  textareaRef,
  onInputChange,
  onInputKeyDown,
  onTextareaInput,
  onSend,
  connectors,
  onConnectorsChange,
  onGeneratePreview,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [modalType, setModalType] = useState<'lesson_plan' | 'lab' | null>(null)
  const [week, setWeek] = useState('1')
  const [topic, setTopic] = useState('')

  function openModal(type: 'lesson_plan' | 'lab') {
    setModalType(type)
    setMenuOpen(false)
  }

  function closeModal() {
    setModalType(null)
    setTopic('')
  }

  function submitPreview() {
    const parsedWeek = Number.parseInt(week, 10)
    if (!modalType || Number.isNaN(parsedWeek) || parsedWeek < 1) return
    onGeneratePreview({ artifactType: modalType, week: parsedWeek, topic })
    closeModal()
  }

  return (
    <footer
      className={`relative z-10 px-4 pb-5 pt-2 bg-gradient-to-t from-white/60 via-white/30 to-transparent backdrop-blur-sm flex-shrink-0 transition-opacity ${
        dimmed ? 'opacity-40 pointer-events-none' : ''
      }`}
    >
      <div className="max-w-3xl mx-auto">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen((value) => !value)}
              disabled={disabled || sending}
              className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-white/75 px-3 py-1.5 text-sm font-medium text-emerald-700 shadow-sm hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Sparkles className="h-4 w-4" />
              Generate
            </button>
            {menuOpen && (
              <div className="absolute bottom-full left-0 z-30 mb-2 w-56 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl">
                <button
                  type="button"
                  onClick={() => openModal('lesson_plan')}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-emerald-50"
                >
                  <BookOpen className="h-4 w-4 text-emerald-600" />
                  Lesson Plan Preview
                </button>
                <button
                  type="button"
                  onClick={() => openModal('lab')}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-emerald-50"
                >
                  <FlaskConical className="h-4 w-4 text-emerald-600" />
                  Lab Preview
                </button>
              </div>
            )}
          </div>
          <ConnectorToggles
            connectors={connectors}
            onChange={onConnectorsChange}
            disabled={disabled || sending}
          />
        </div>
        <div className="flex items-end gap-2 p-2 rounded-[28px] bg-white/55 border border-white/60 shadow-[0_8px_32px_rgba(15,23,42,0.08)]">
          <textarea
            ref={textareaRef}
            rows={1}
            value={input}
            onChange={(e) => onInputChange(e.target.value)}
            onInput={onTextareaInput}
            onKeyDown={onInputKeyDown}
            placeholder="Message your teaching assistant…"
            disabled={disabled || sending}
            className="flex-1 resize-none bg-transparent px-4 py-3 text-[15px] text-slate-800 placeholder:text-slate-400 focus:outline-none disabled:cursor-not-allowed max-h-40 overflow-y-auto leading-6"
          />
          <button
            type="button"
            onClick={onSend}
            disabled={!input.trim() || disabled || sending}
            className="flex-shrink-0 inline-flex items-center justify-center w-10 h-10 mb-0.5 mr-1 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white shadow-md shadow-emerald-600/25 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
            aria-label="Send message"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
        <p className="mt-2.5 text-center text-xs text-slate-400">
          Enter to send · Shift+Enter for new line
        </p>
      </div>
      {modalType && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/20 px-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-white/70 bg-white p-4 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-900">
                {modalType === 'lab' ? 'Lab Preview' : 'Lesson Plan Preview'}
              </h3>
              <button
                type="button"
                onClick={closeModal}
                className="inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <label className="mb-3 block">
              <span className="mb-1 block text-sm font-medium text-slate-700">Week</span>
              <input
                type="number"
                min={1}
                value={week}
                onChange={(event) => setWeek(event.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-slate-700">Topic / instructions</span>
              <textarea
                rows={4}
                value={topic}
                onChange={(event) => setTopic(event.target.value)}
                className="w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                placeholder="Add topic, constraints, duration, or teaching preferences..."
              />
            </label>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={closeModal}
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submitPreview}
                disabled={disabled || sending}
                className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Generate Preview
              </button>
            </div>
          </div>
        </div>
      )}
    </footer>
  )
}

type MessagesPanelProps = {
  batchId?: string
  messages: ChatMessage[]
  messagesLoading: boolean
  showWelcome: boolean
  sending: boolean
  runStates: Record<string, RunUiState>
  messagesEndRef: RefObject<HTMLDivElement | null>
  welcomeContent: React.ReactNode
}

export function ChatMessagesPanel({
  batchId,
  messages,
  messagesLoading,
  showWelcome,
  sending,
  runStates,
  messagesEndRef,
  welcomeContent,
}: MessagesPanelProps) {
  const safeMessages = messages.filter(Boolean)

  return (
    <main className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto px-4 py-8 min-h-full flex flex-col">
        {messagesLoading ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="w-6 h-6 text-emerald-600 animate-spin" />
          </div>
        ) : showWelcome ? (
          welcomeContent
        ) : (
          <div className="space-y-8 pb-4">
            {safeMessages.map((msg) => (
              <MessageRow
                key={msg.message_id}
                msg={msg}
                run={msg.run_id ? runStates[msg.run_id] : undefined}
                batchId={batchId}
              />
            ))}
            {sending && !safeMessages.some((msg) => msg.pending) && <ThinkingIndicator />}
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>
    </main>
  )
}
