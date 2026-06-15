import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Bot,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Loader2,
  MessageSquarePlus,
  MoreHorizontal,
  Send,
  Sparkles,
  Trash2,
  User,
} from 'lucide-react'
import type { Batch } from '../entity/Batch'
import type { Chat, ChatMessage } from '../entity/Chat'
import { useAuth } from '../hooks/useAuth'
import { listBatches } from '../services/batchService'
import {
  createChat,
  deleteChat,
  listChats,
  listMessages,
  sendMessage,
  updateChatTitle,
} from '../services/chatService'

const SUGGESTIONS = [
  'Help me plan a lesson on this topic',
  'Create a quiz for my students',
  'Draft an announcement email',
  'Summarise the uploaded materials',
]

// ─── Sub-components ──────────────────────────────────────────────────────────

function MessageRow({ msg }: { msg: ChatMessage }) {
  const isUser = msg.role === 'user'
  return (
    <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : ''}`}>
      <div
        className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
          isUser
            ? 'bg-emerald-500/90 text-white shadow-md shadow-emerald-500/20'
            : 'bg-white/70 border border-white/60 text-slate-600 shadow-sm'
        }`}
      >
        {isUser ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
      </div>
      <div className={`flex-1 min-w-0 pt-1 ${isUser ? 'flex justify-end' : ''}`}>
        <div
          className={`inline-block max-w-full text-[15px] leading-7 whitespace-pre-wrap ${
            isUser
              ? 'px-4 py-2.5 rounded-3xl rounded-br-md bg-emerald-500/15 border border-emerald-300/30 text-slate-800'
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
    <div className="flex gap-3">
      <div className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center bg-white/70 border border-white/60 text-slate-600 shadow-sm">
        <Bot className="w-4 h-4" />
      </div>
      <div className="pt-2">
        <div className="inline-flex items-center gap-1 px-4 py-3 rounded-2xl bg-white/50 border border-white/50">
          {[0, 150, 300].map((delay) => (
            <span
              key={delay}
              className="w-2 h-2 rounded-full bg-slate-400 animate-bounce"
              style={{ animationDelay: `${delay}ms` }}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function Chat() {
  const { user } = useAuth()
  const navigate = useNavigate()

  // Batch selection
  const [batches, setBatches] = useState<Batch[]>([])
  const [batchesLoading, setBatchesLoading] = useState(true)
  const [selectedBatch, setSelectedBatch] = useState<Batch | null>(null)

  // Sidebar — chat list
  const [chats, setChats] = useState<Chat[]>([])
  const [chatsLoading, setChatsLoading] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  // Active chat + messages
  const [activeChat, setActiveChat] = useState<Chat | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [messagesLoading, setMessagesLoading] = useState(false)

  // Input
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const renameInputRef = useRef<HTMLInputElement>(null)

  // ── Load batches ────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!user) return
    setBatchesLoading(true)
    listBatches()
      .then((data) => setBatches(data))
      .catch(console.error)
      .finally(() => setBatchesLoading(false))
  }, [user])

  // ── Load chats when batch selected ─────────────────────────────────────────

  const loadChats = useCallback(async (batchId: string) => {
    setChatsLoading(true)
    try {
      const data = await listChats(batchId)
      setChats(data)
    } catch (err) {
      console.error(err)
    } finally {
      setChatsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!selectedBatch) {
      setChats([])
      setActiveChat(null)
      setMessages([])
      return
    }
    void loadChats(selectedBatch.id)
  }, [selectedBatch, loadChats])

  // ── Load messages when chat selected ────────────────────────────────────────

  useEffect(() => {
    if (!activeChat || !selectedBatch) {
      setMessages([])
      return
    }
    setMessagesLoading(true)
    listMessages(selectedBatch.id, activeChat.chat_id)
      .then(setMessages)
      .catch(console.error)
      .finally(() => setMessagesLoading(false))
  }, [activeChat, selectedBatch])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, sending])

  // ── New chat ────────────────────────────────────────────────────────────────

  async function handleNewChat() {
    if (!selectedBatch) return
    const chat = await createChat(selectedBatch.id, 'New Chat')
    setChats((prev) => [chat, ...prev])
    setActiveChat(chat)
    setMessages([])
  }

  // ── Send message ────────────────────────────────────────────────────────────

  async function handleSend(text?: string) {
    const content = (text ?? input).trim()
    if (!content || !activeChat || !selectedBatch || sending) return
    setInput('')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
    setSending(true)

    const optimisticUser: ChatMessage = {
      message_id: crypto.randomUUID(),
      chat_id: activeChat.chat_id,
      role: 'user',
      content,
      created_at: new Date().toISOString(),
    }
    setMessages((prev) => [...prev, optimisticUser])

    try {
      const { assistant_message } = await sendMessage(
        selectedBatch.id,
        activeChat.chat_id,
        content,
      )
      setMessages((prev) => [...prev, assistant_message])

      // Auto-name the chat from first user message (if still "New Chat")
      if (activeChat.title === 'New Chat') {
        const newTitle = content.slice(0, 50)
        void updateChatTitle(selectedBatch.id, activeChat.chat_id, newTitle).then(() => {
          setChats((prev) =>
            prev.map((c) =>
              c.chat_id === activeChat.chat_id ? { ...c, title: newTitle } : c,
            ),
          )
          setActiveChat((prev) => (prev ? { ...prev, title: newTitle } : prev))
        })
      }
    } catch (err) {
      console.error(err)
      const errMsg: ChatMessage = {
        message_id: crypto.randomUUID(),
        chat_id: activeChat.chat_id,
        role: 'assistant',
        content: 'Sorry, something went wrong. Please try again.',
        created_at: new Date().toISOString(),
      }
      setMessages((prev) => [...prev, errMsg])
    } finally {
      setSending(false)
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

  // ── Chat rename ─────────────────────────────────────────────────────────────

  function startRename(chat: Chat) {
    setRenamingId(chat.chat_id)
    setRenameValue(chat.title)
    setTimeout(() => renameInputRef.current?.focus(), 50)
  }

  async function commitRename() {
    if (!renamingId || !selectedBatch) return
    const title = renameValue.trim() || 'New Chat'
    await updateChatTitle(selectedBatch.id, renamingId, title).catch(console.error)
    setChats((prev) => prev.map((c) => (c.chat_id === renamingId ? { ...c, title } : c)))
    if (activeChat?.chat_id === renamingId) setActiveChat((prev) => (prev ? { ...prev, title } : prev))
    setRenamingId(null)
  }

  // ── Delete chat ─────────────────────────────────────────────────────────────

  async function handleDeleteChat(chat: Chat) {
    if (!selectedBatch) return
    if (!window.confirm(`Delete "${chat.title}"?`)) return
    await deleteChat(selectedBatch.id, chat.chat_id).catch(console.error)
    setChats((prev) => prev.filter((c) => c.chat_id !== chat.chat_id))
    if (activeChat?.chat_id === chat.chat_id) {
      setActiveChat(null)
      setMessages([])
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Empty / no batches state
  // ─────────────────────────────────────────────────────────────────────────────

  if (!batchesLoading && batches.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 text-center px-4 py-20">
        <div className="w-14 h-14 rounded-2xl bg-white/50 border border-white/60 shadow-lg flex items-center justify-center mb-6">
          <Sparkles className="w-7 h-7 text-emerald-600" />
        </div>
        <h2 className="text-2xl font-semibold text-slate-800 mb-2">No batches yet</h2>
        <p className="text-slate-500 text-sm max-w-sm mb-6">
          Create a batch first to start chatting with your AI teaching assistant.
        </p>
        <button
          type="button"
          onClick={() => navigate('/batches')}
          className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium rounded-md text-white bg-emerald-600 hover:bg-emerald-700 shadow-sm"
        >
          <ExternalLink className="w-4 h-4" />
          Go to Batches
        </button>
      </div>
    )
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Batch selection state
  // ─────────────────────────────────────────────────────────────────────────────

  if (!selectedBatch) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 text-center px-4 py-20">
        <div className="w-14 h-14 rounded-2xl bg-white/50 border border-white/60 shadow-lg flex items-center justify-center mb-6">
          <Sparkles className="w-7 h-7 text-emerald-600" />
        </div>
        <h2 className="text-2xl font-semibold text-slate-800 mb-2">AI Teaching Assistant</h2>
        <p className="text-slate-500 text-sm max-w-sm mb-8">
          Choose a batch to start chatting about lesson plans, assessments, and more.
        </p>
        {batchesLoading ? (
          <Loader2 className="w-6 h-6 text-emerald-600 animate-spin" />
        ) : (
          <div className="w-full max-w-sm space-y-2">
            {batches.map((batch) => (
              <button
                key={batch.id}
                type="button"
                onClick={() => setSelectedBatch(batch)}
                className="w-full flex items-start gap-3 p-4 rounded-xl bg-white/60 border border-white/60 shadow-sm hover:bg-white/80 hover:shadow-md transition-all text-left"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-slate-800 truncate">
                    {batch.batch_name}
                  </div>
                  <div className="text-xs text-slate-500 truncate">
                    {batch.course_name}
                    {batch.academic_year ? ` · ${batch.academic_year}` : ''}
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-slate-400 mt-0.5 flex-shrink-0" />
              </button>
            ))}
          </div>
        )}
      </div>
    )
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Main chat layout
  // ─────────────────────────────────────────────────────────────────────────────

  const showWelcome = activeChat && messages.length === 0 && !messagesLoading && !sending

  return (
    <div className="relative flex flex-col flex-1 min-h-0 -mx-4 md:-mx-8 -my-4 md:-my-8 overflow-hidden">
      {/* Background blobs */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        <div className="absolute -top-24 left-1/4 w-72 h-72 rounded-full bg-emerald-200/30 blur-3xl" />
        <div className="absolute bottom-20 right-1/4 w-96 h-96 rounded-full bg-sky-200/25 blur-3xl" />
      </div>

      {/* Top bar */}
      <header className="relative z-10 flex-shrink-0 h-14 px-4 flex items-center gap-3 backdrop-blur-xl bg-white/20 border-b border-white/40">
        <button
          type="button"
          onClick={() => setSelectedBatch(null)}
          className="p-1.5 rounded-lg hover:bg-white/50 text-slate-500 hover:text-slate-700 transition-colors"
          aria-label="Back to batch selection"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-slate-800 truncate">{selectedBatch.batch_name}</div>
          <div className="text-xs text-slate-500 truncate">{selectedBatch.course_name}</div>
        </div>
        <button
          type="button"
          onClick={() => setSidebarOpen((v) => !v)}
          className="p-1.5 rounded-lg hover:bg-white/50 text-slate-500 hover:text-slate-700 transition-colors"
          aria-label={sidebarOpen ? 'Close sidebar' : 'Open sidebar'}
        >
          {sidebarOpen ? <ChevronRight className="w-5 h-5" /> : <ChevronLeft className="w-5 h-5" />}
        </button>
      </header>

      {/* Body */}
      <div className="relative z-0 flex flex-1 min-h-0">
        {/* Sidebar — chat list */}
        <aside
          className={`flex-shrink-0 transition-all duration-300 overflow-hidden ${
            sidebarOpen ? 'w-64 border-r border-white/40' : 'w-0'
          } flex flex-col backdrop-blur-xl bg-white/20`}
        >
          <div className="p-3 border-b border-white/40 flex-shrink-0">
            <button
              type="button"
              onClick={() => void handleNewChat()}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 transition-colors shadow-sm"
            >
              <MessageSquarePlus className="w-4 h-4" />
              New Chat
            </button>
          </div>

          <div className="flex-1 overflow-y-auto py-1">
            {chatsLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="w-5 h-5 text-emerald-600 animate-spin" />
              </div>
            ) : chats.length === 0 ? (
              <p className="text-xs text-slate-400 text-center py-8 px-3">
                No chats yet. Start a new one.
              </p>
            ) : (
              chats.map((chat) => (
                <div
                  key={chat.chat_id}
                  className={`group relative flex items-center gap-2 mx-2 my-0.5 rounded-lg px-3 py-2 cursor-pointer transition-colors ${
                    activeChat?.chat_id === chat.chat_id
                      ? 'bg-white/50 text-slate-900'
                      : 'text-slate-600 hover:bg-white/30 hover:text-slate-800'
                  }`}
                  onClick={() => {
                    if (renamingId === chat.chat_id) return
                    setActiveChat(chat)
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
                        if (e.key === 'Escape') setRenamingId(null)
                      }}
                      className="flex-1 min-w-0 bg-transparent text-sm outline-none border-b border-emerald-400"
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <span className="flex-1 min-w-0 text-sm truncate">{chat.title}</span>
                  )}

                  <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 flex-shrink-0 transition-opacity">
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); startRename(chat) }}
                      className="p-1 rounded hover:bg-white/50 text-slate-400 hover:text-slate-600"
                      aria-label="Rename"
                    >
                      <MoreHorizontal className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); void handleDeleteChat(chat) }}
                      className="p-1 rounded hover:bg-red-50 text-slate-400 hover:text-red-500"
                      aria-label="Delete"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </aside>

        {/* Chat area */}
        <div className="flex flex-col flex-1 min-w-0 min-h-0">
          {!activeChat ? (
            /* No chat selected — prompt to pick or create */
            <div className="flex-1 flex flex-col items-center justify-center text-center px-4">
              <div className="w-12 h-12 rounded-2xl bg-white/50 border border-white/60 shadow-lg flex items-center justify-center mb-4">
                <Sparkles className="w-6 h-6 text-emerald-600" />
              </div>
              <h3 className="text-lg font-semibold text-slate-700 mb-1">Start a conversation</h3>
              <p className="text-sm text-slate-500 mb-4 max-w-xs">
                Select a previous chat or start a new one about {selectedBatch.batch_name}.
              </p>
              <button
                type="button"
                onClick={() => void handleNewChat()}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm"
              >
                <MessageSquarePlus className="w-4 h-4" />
                New Chat
              </button>
            </div>
          ) : (
            <>
              {/* Messages */}
              <main className="flex-1 overflow-y-auto">
                <div className="max-w-3xl mx-auto px-4 py-8 min-h-full flex flex-col">
                  {messagesLoading ? (
                    <div className="flex-1 flex items-center justify-center">
                      <Loader2 className="w-6 h-6 text-emerald-600 animate-spin" />
                    </div>
                  ) : showWelcome ? (
                    <div className="flex-1 flex flex-col items-center justify-center text-center py-12">
                      <div className="w-12 h-12 rounded-2xl bg-white/50 border border-white/60 shadow-lg flex items-center justify-center mb-5">
                        <Sparkles className="w-6 h-6 text-emerald-600" />
                      </div>
                      <h2 className="text-xl font-semibold text-slate-800 mb-1">
                        How can I help you teach today?
                      </h2>
                      <p className="text-slate-500 text-sm mb-8">
                        Chatting in{' '}
                        <span className="font-medium text-slate-700">{activeChat.title}</span>
                      </p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-lg">
                        {SUGGESTIONS.map((s) => (
                          <button
                            key={s}
                            type="button"
                            onClick={() => void handleSend(s)}
                            className="px-4 py-3 text-sm text-left text-slate-600 rounded-2xl bg-white/40 border border-white/50 hover:bg-white/60 hover:text-slate-800 shadow-sm transition-all"
                          >
                            {s}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-6 pb-4">
                      {messages.map((msg) => (
                        <MessageRow key={msg.message_id} msg={msg} />
                      ))}
                      {sending && <ThinkingIndicator />}
                    </div>
                  )}
                  <div ref={messagesEndRef} />
                </div>
              </main>

              {/* Input */}
              <footer className="relative z-10 px-4 pb-5 pt-2 bg-gradient-to-t from-white/60 via-white/30 to-transparent backdrop-blur-sm flex-shrink-0">
                <div className="max-w-3xl mx-auto">
                  <div className="flex items-end gap-2 p-2 rounded-[28px] bg-white/55 border border-white/60 shadow-[0_8px_32px_rgba(15,23,42,0.08)]">
                    <textarea
                      ref={textareaRef}
                      rows={1}
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      onInput={handleTextareaInput}
                      onKeyDown={handleInputKeyDown}
                      placeholder="Message your teaching assistant…"
                      disabled={sending}
                      className="flex-1 resize-none bg-transparent px-4 py-3 text-[15px] text-slate-800 placeholder:text-slate-400 focus:outline-none disabled:cursor-not-allowed max-h-40 overflow-y-auto leading-6"
                    />
                    <button
                      type="button"
                      onClick={() => void handleSend()}
                      disabled={!input.trim() || sending}
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
              </footer>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
