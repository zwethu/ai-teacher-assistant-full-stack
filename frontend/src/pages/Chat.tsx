import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import {
  addDoc,
  collection,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  where,
} from 'firebase/firestore'
import {
  ArrowLeft,
  Bot,
  Check,
  ChevronDown,
  Loader2,
  Plus,
  Send,
  Sparkles,
  User,
} from 'lucide-react'
import type { Batch } from '../entity/Batch'
import type { ChatMessage } from '../entity/Chat'
import { useAuth } from '../hooks/useAuth'
import { db } from '../lib/firebase'
import { addMessage, createChat } from '../services/chatService'

const SUGGESTIONS = [
  'Help me plan a lesson on fractions',
  'Create a quiz for my class',
  'Draft an email to parents',
  'Suggest classroom activities',
]

type BatchDropdownProps = {
  batches: Batch[]
  uid: string
  selectedBatch: Batch | null
  onSelect: (batch: Batch) => void
  mode?: 'center' | 'header'
  defaultOpen?: boolean
}

function BatchDropdown({
  batches,
  uid,
  selectedBatch,
  onSelect,
  mode = 'header',
  defaultOpen = false,
}: BatchDropdownProps) {
  const [open, setOpen] = useState(defaultOpen)
  const isCenter = mode === 'center'
  const [creating, setCreating] = useState(false)
  const [newLabel, setNewLabel] = useState('')
  const [saving, setSaving] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
        setCreating(false)
        setNewLabel('')
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  const handleCreate = useCallback(async () => {
    const label = newLabel.trim()
    if (!label || saving) return

    setSaving(true)
    try {
      const ref = collection(db, 'batches')
      const docRef = await addDoc(ref, {
        uid,
        label,
        createdAt: serverTimestamp(),
      })
      const batch: Batch = {
        id: docRef.id,
        uid,
        label,
        createdAt: null,
      }
      onSelect(batch)
      setOpen(false)
      setCreating(false)
      setNewLabel('')
    } finally {
      setSaving(false)
    }
  }, [newLabel, saving, uid, onSelect])

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      void handleCreate()
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex items-center gap-2 rounded-full backdrop-blur-xl bg-white/50 border border-white/60 shadow-sm font-medium text-slate-700 hover:bg-white/70 transition-all ${
          isCenter
            ? 'px-6 py-3 text-base shadow-md shadow-slate-200/40'
            : 'px-4 py-2 text-sm'
        }`}
      >
        <span className={`truncate ${isCenter ? 'max-w-[260px]' : 'max-w-[200px]'}`}>
          {selectedBatch ? selectedBatch.label : 'Select a batch'}
        </span>
        <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform duration-300 ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div
          className={`absolute left-1/2 -translate-x-1/2 rounded-2xl backdrop-blur-2xl bg-white/80 border border-white/60 shadow-[0_16px_48px_rgba(15,23,42,0.12)] overflow-hidden z-20 ${
            isCenter ? 'top-full mt-3 w-80' : 'top-full mt-2 w-72'
          }`}
        >
          {creating ? (
            <div className="p-4 space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                New batch
              </p>
              <input
                type="text"
                autoFocus
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="e.g. Grade 10A - Math 2024"
                disabled={saving}
                className="w-full px-3 py-2.5 rounded-xl bg-white/60 border border-slate-200/50 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-400/40 disabled:opacity-60"
              />
              <div className="flex gap-2">
                {batches.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setCreating(false)
                      setNewLabel('')
                    }}
                    disabled={saving}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 text-sm rounded-xl border border-slate-200/60 text-slate-600 hover:bg-white/60 transition-colors disabled:opacity-60"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    Back
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void handleCreate()}
                  disabled={!newLabel.trim() || saving}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60 transition-colors"
                >
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Create'}
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="max-h-56 overflow-y-auto py-1">
                {batches.length === 0 ? (
                  <p className="px-4 py-6 text-sm text-slate-500 text-center">
                    No batches yet
                  </p>
                ) : (
                  batches.map((batch) => (
                    <button
                      key={batch.id}
                      type="button"
                      onClick={() => {
                        onSelect(batch)
                        setOpen(false)
                      }}
                      className="w-full flex items-center justify-between gap-2 px-4 py-2.5 text-sm text-slate-700 hover:bg-emerald-50/60 transition-colors text-left"
                    >
                      <span className="truncate">{batch.label}</span>
                      {selectedBatch?.id === batch.id && (
                        <Check className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                      )}
                    </button>
                  ))
                )}
              </div>
              <div className="border-t border-slate-200/50 p-2">
                <button
                  type="button"
                  onClick={() => setCreating(true)}
                  className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-slate-600 hover:bg-white/60 rounded-xl transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  Create new batch
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function MessageRow({ msg }: { msg: ChatMessage }) {
  const isUser = msg.role === 'user'

  return (
    <div className={`flex gap-4 ${isUser ? 'flex-row-reverse' : ''}`}>
      <div
        className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center backdrop-blur-md border ${
          isUser
            ? 'bg-emerald-500/90 border-emerald-400/40 text-white shadow-md shadow-emerald-500/20'
            : 'bg-white/70 border-white/60 text-slate-600 shadow-sm'
        }`}
      >
        {isUser ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
      </div>
      <div
        className={`flex-1 min-w-0 pt-1 ${
          isUser ? 'flex justify-end' : ''
        }`}
      >
        <div
          className={`inline-block max-w-full text-[15px] leading-7 whitespace-pre-wrap ${
            isUser
              ? 'px-4 py-2.5 rounded-3xl rounded-br-md backdrop-blur-md bg-emerald-500/15 border border-emerald-300/30 text-slate-800 shadow-sm'
              : 'text-slate-700'
          }`}
        >
          {msg.content}
        </div>
      </div>
    </div>
  )
}

function ThinkingIndicator() {
  return (
    <div className="flex gap-4">
      <div className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center backdrop-blur-md bg-white/70 border border-white/60 text-slate-600 shadow-sm">
        <Bot className="w-4 h-4" />
      </div>
      <div className="pt-2">
        <div className="inline-flex items-center gap-1 px-4 py-3 rounded-2xl backdrop-blur-md bg-white/50 border border-white/50">
          <span
            className="w-2 h-2 rounded-full bg-slate-400 animate-bounce"
            style={{ animationDelay: '0ms' }}
          />
          <span
            className="w-2 h-2 rounded-full bg-slate-400 animate-bounce"
            style={{ animationDelay: '150ms' }}
          />
          <span
            className="w-2 h-2 rounded-full bg-slate-400 animate-bounce"
            style={{ animationDelay: '300ms' }}
          />
        </div>
      </div>
    </div>
  )
}

export default function Chat() {
  const { user } = useAuth()

  const [batches, setBatches] = useState<Batch[]>([])
  const [selectedBatch, setSelectedBatch] = useState<Batch | null>(null)
  const [chatId, setChatId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [welcomeVisible, setWelcomeVisible] = useState(false)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!user) return

    async function loadBatches() {
      const ref = collection(db, 'batches')
      const q = query(
        ref,
        where('uid', '==', user!.uid),
        orderBy('createdAt', 'desc'),
      )
      const snap = await getDocs(q)
      const loaded = snap.docs.map((d) => {
        const data = d.data()
        return {
          id: d.id,
          uid: data.uid,
          label: data.label ?? '',
          createdAt: data.createdAt ? data.createdAt.toDate?.() ?? null : null,
        }
      })
      setBatches(loaded)
    }

    void loadBatches()
  }, [user])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  useEffect(() => {
    if (!selectedBatch || messages.length > 0) {
      setWelcomeVisible(false)
      return
    }

    const timer = setTimeout(() => setWelcomeVisible(true), 520)
    return () => clearTimeout(timer)
  }, [selectedBatch, messages.length])

  const handleBatchSelect = useCallback(
    async (batch: Batch) => {
      if (!user) return

      setSelectedBatch(batch)
      setMessages([])
      setBatches((prev) => {
        if (prev.some((b) => b.id === batch.id)) return prev
        return [batch, ...prev]
      })

      const id = await createChat(user.uid, batch.id, batch.label)
      setChatId(id)
    },
    [user],
  )

  async function handleSend(text?: string) {
    const userText = (text ?? input).trim()
    if (!userText || !chatId || !selectedBatch || loading) return

    setInput('')
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }

    const tempUserMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: userText,
      createdAt: new Date(),
    }
    setMessages((prev) => [...prev, tempUserMessage])
    setLoading(true)

    try {
      await addMessage(chatId, 'user', userText)

      const reply = `(AI agent not connected yet) You said: "${userText}"`
      await addMessage(chatId, 'assistant', reply)

      const assistantMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: reply,
        createdAt: new Date(),
      }
      setMessages((prev) => [...prev, assistantMessage])
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  function handleInputKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void handleSend()
    }
  }

  function handleTextareaInput() {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }

  const hasBatch = !!selectedBatch
  const showWelcome = hasBatch && messages.length === 0 && !loading

  return (
    <div className="relative flex flex-col flex-1 min-h-0 -mx-4 md:-mx-8 -my-4 md:-my-8">
      <div
        className="pointer-events-none absolute inset-0 overflow-hidden"
        aria-hidden="true"
      >
        <div className="absolute -top-24 left-1/4 w-72 h-72 rounded-full bg-emerald-200/30 blur-3xl" />
        <div className="absolute bottom-20 right-1/4 w-96 h-96 rounded-full bg-sky-200/25 blur-3xl" />
      </div>

      {user && (
        <div
          className={`absolute left-1/2 z-30 -translate-x-1/2 transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)] ${
            hasBatch ? 'top-3' : 'top-[42%] -translate-y-1/2'
          }`}
        >
          <BatchDropdown
            batches={batches}
            uid={user.uid}
            selectedBatch={selectedBatch}
            onSelect={(batch) => void handleBatchSelect(batch)}
            mode={hasBatch ? 'header' : 'center'}
            defaultOpen={!hasBatch}
          />
        </div>
      )}

      <header
        className={`relative z-10 flex-shrink-0 transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)] ${
          hasBatch
            ? 'h-14 backdrop-blur-xl bg-white/20 border-b border-white/40'
            : 'h-0 border-b border-transparent overflow-hidden'
        }`}
      />

      <main className="relative z-0 flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-4 py-8 min-h-full flex flex-col">
          {!hasBatch && (
            <div className="flex-1 flex flex-col items-center justify-center text-center px-4 pb-32">
              <div className="w-14 h-14 rounded-2xl backdrop-blur-xl bg-white/50 border border-white/60 shadow-lg flex items-center justify-center mb-6 -mt-24">
                <Sparkles className="w-7 h-7 text-emerald-600" />
              </div>
              <h2 className="text-2xl font-semibold text-slate-800 mb-2">
                AI Teaching Assistant
              </h2>
              <p className="text-slate-500 text-sm max-w-sm mb-28">
                Choose a batch to start chatting about lesson plans, assessments, and more.
              </p>
            </div>
          )}

          {showWelcome && selectedBatch && (
            <div
              className={`flex-1 flex flex-col items-center justify-center text-center py-12 transition-all duration-500 ease-out ${
                welcomeVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
              }`}
            >
              <div className="w-14 h-14 rounded-2xl backdrop-blur-xl bg-white/50 border border-white/60 shadow-lg flex items-center justify-center mb-6">
                <Sparkles className="w-7 h-7 text-emerald-600" />
              </div>
              <h2 className="text-2xl font-semibold text-slate-800 mb-2">
                How can I help you teach today?
              </h2>
              <p className="text-slate-500 text-sm mb-8">
                Chatting with{' '}
                <span className="font-medium text-slate-700">{selectedBatch.label}</span>
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-lg">
                {SUGGESTIONS.map((suggestion, i) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => void handleSend(suggestion)}
                    className={`px-4 py-3 text-sm text-left text-slate-600 rounded-2xl backdrop-blur-md bg-white/40 border border-white/50 hover:bg-white/60 hover:border-emerald-200/60 hover:text-slate-800 shadow-sm transition-all duration-500 ease-out ${
                      welcomeVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3'
                    }`}
                    style={{ transitionDelay: welcomeVisible ? `${120 + i * 75}ms` : '0ms' }}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.length > 0 && (
            <div className="space-y-8 pb-4">
              {messages.map((msg) => (
                <MessageRow key={msg.id} msg={msg} />
              ))}
              {loading && <ThinkingIndicator />}
            </div>
          )}

          {messages.length === 0 && loading && <ThinkingIndicator />}

          <div ref={messagesEndRef} />
        </div>
      </main>

      <footer className="relative z-10 px-4 pb-5 pt-2 bg-gradient-to-t from-white/60 via-white/30 to-transparent backdrop-blur-sm">
        <div className="max-w-3xl mx-auto">
          <div
            className={`flex items-end gap-2 p-2 rounded-[28px] backdrop-blur-xl bg-white/55 border border-white/60 shadow-[0_8px_32px_rgba(15,23,42,0.08)] transition-opacity ${
              !selectedBatch ? 'opacity-60' : ''
            }`}
          >
            <textarea
              ref={textareaRef}
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onInput={handleTextareaInput}
              onKeyDown={handleInputKeyDown}
              placeholder={
                selectedBatch
                  ? 'Message your teaching assistant…'
                  : 'Select a batch to start…'
              }
              disabled={!selectedBatch || loading}
              className="flex-1 resize-none bg-transparent px-4 py-3 text-[15px] text-slate-800 placeholder:text-slate-400 focus:outline-none disabled:cursor-not-allowed max-h-40 overflow-y-auto leading-6"
            />
            <button
              type="button"
              onClick={() => void handleSend()}
              disabled={!input.trim() || !selectedBatch || loading}
              className="flex-shrink-0 inline-flex items-center justify-center w-10 h-10 mb-0.5 mr-1 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white shadow-md shadow-emerald-600/25 disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none transition-all"
              aria-label="Send message"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
          <p className="mt-2.5 text-center text-xs text-slate-400">
            Press Enter to send · Shift+Enter for new line
          </p>
        </div>
      </footer>
    </div>
  )
}
