import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react'
import axios from 'axios'
import { useLocation, useNavigate } from 'react-router-dom'
import type { Batch } from '../../../entity/Batch'
import type { Chat, ChatMessage } from '../../../entity/Chat'
import { useAuth } from '../../../hooks/useAuth'
import { listBatches } from '../../../services/batchService'
import {
  createChat,
  deleteChat,
  listChats,
  listMessages,
  sendMessage,
  updateChatTitle,
} from '../../../services/chatService'
import { subscribeAgentRun } from '../../../services/agentRunStream'
import { emitChatCreated } from '../../../utils/chatEvents'

type ChatLocationState = {
  batchId?: string
  chatId?: string
  initialMessage?: string
}

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

function connectorErrorMessage(err: unknown): string {
  if (!axios.isAxiosError(err)) {
    return 'Sorry, something went wrong. Please try again.'
  }

  const detail = err.response?.data?.detail
  const code = typeof detail?.code === 'string' ? detail.code : ''
  const message = typeof detail?.message === 'string' ? detail.message : ''
  const connectUrl = typeof detail?.connect_url === 'string' ? detail.connect_url : ''

  if (code === 'GOOGLE_OAUTH_REQUIRED') {
    const base =
      'Google Workspace is not connected or needs re-consent. Please connect Google Workspace, then try again.'
    if (!connectUrl) return base
    const absoluteUrl = connectUrl.startsWith('http')
      ? connectUrl
      : `${API_URL.replace(/\/$/, '')}${connectUrl.startsWith('/') ? connectUrl : `/${connectUrl}`}`
    return `${base}\n\n[Connect Google Workspace](${absoluteUrl})`
  }

  if (code === 'GOOGLE_CONNECTOR_DISABLED') {
    return 'Google Workspace connector is disabled. Enable it in chat connectors to export Docs, Forms, Gmail, or Calendar.'
  }

  return message || 'Sorry, something went wrong. Please try again.'
}

export function useChatPage() {
  const { user } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const appliedRouteStateRef = useRef<string | null>(null)
  const pendingChatIdRef = useRef<string | null>(null)
  const pendingInitialMessageRef = useRef<string | null>(null)
  const runUnsubscribeRef = useRef<(() => void) | null>(null)
  const runFallbackTimerRef = useRef<number | null>(null)

  const [batches, setBatches] = useState<Batch[]>([])
  const [batchesLoading, setBatchesLoading] = useState(true)
  const [selectedBatch, setSelectedBatch] = useState<Batch | null>(null)

  const [chats, setChats] = useState<Chat[]>([])
  const [chatsLoading, setChatsLoading] = useState(false)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  const [activeChat, setActiveChat] = useState<Chat | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [messagesLoading, setMessagesLoading] = useState(false)

  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [currentRunId, setCurrentRunId] = useState<string | null>(null)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const renameInputRef = useRef<HTMLInputElement>(null)
  
  const [connectors, setConnectors] = useState({
    web_search: true,
    google_workspace: false,
  })

  useEffect(() => {
    if (!user) return
    setBatchesLoading(true)
    listBatches()
      .then((data) => setBatches(data))
      .catch(console.error)
      .finally(() => setBatchesLoading(false))
  }, [user])

  useEffect(() => {
    const routeState = location.state as ChatLocationState | null
    if (!routeState?.batchId || batches.length === 0) return

    const stateKey = `${routeState.batchId}:${routeState.chatId ?? ''}`
    if (appliedRouteStateRef.current === stateKey) return

    const batch = batches.find((b) => b.id === routeState.batchId)
    if (!batch) return

    setSelectedBatch(batch)
    pendingChatIdRef.current = routeState.chatId ?? null
    pendingInitialMessageRef.current = routeState.initialMessage ?? null
    appliedRouteStateRef.current = stateKey
    navigate(location.pathname, { replace: true, state: null })
  }, [batches, location.pathname, location.state, navigate])

  useEffect(() => {
    if (!selectedBatch || !pendingChatIdRef.current || chats.length === 0) return
    const chat = chats.find((c) => c.chat_id === pendingChatIdRef.current)
    if (chat) {
      setActiveChat(chat)
      pendingChatIdRef.current = null
    }
  }, [selectedBatch, chats])

  const loadChats = useCallback(async (batchId: string) => {
    setChatsLoading(true)
    try {
      const data = await listChats(batchId)
      setChats(data)
      return data
    } catch (err) {
      console.error(err)
      return []
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
    return () => {
      runUnsubscribeRef.current?.()
      if (runFallbackTimerRef.current) {
        window.clearTimeout(runFallbackTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, sending])

  async function handleNewChat(title = 'New Chat') {
    if (!selectedBatch) return null
    const chat = await createChat(selectedBatch.id, title)
    setChats((prev) => [chat, ...prev])
    setActiveChat(chat)
    setMessages([])
    emitChatCreated()
    return chat
  }

  async function handleSend(text?: string) {
    const content = (text ?? input).trim()
    if (!content || !selectedBatch || sending) return

    let chat = activeChat
    if (!chat) {
      chat = await handleNewChat(content.slice(0, 50) || 'New Chat')
      if (!chat) return
    }

    setInput('')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
    setSending(true)

    const optimisticUser: ChatMessage = {
      message_id: crypto.randomUUID(),
      chat_id: chat.chat_id,
      role: 'user',
      content,
      created_at: new Date().toISOString(),
    }
    setMessages((prev) => [...prev, optimisticUser])

    try {
      const result = await sendMessage(
        selectedBatch.id,
        chat.chat_id,
        content,
        connectors,
      )
      const pendingId = `pending-${result.run_id}`
      setCurrentRunId(result.run_id)
      setMessages((prev) => [
        ...prev.filter(Boolean),
        {
          message_id: pendingId,
          chat_id: chat.chat_id,
          role: 'assistant',
          content: 'Working...',
          created_at: new Date().toISOString(),
          status: 'pending',
          run_id: result.run_id,
          pending: true,
        },
      ])

      runUnsubscribeRef.current?.()
      if (runFallbackTimerRef.current) {
        window.clearTimeout(runFallbackTimerRef.current)
      }
      runUnsubscribeRef.current = subscribeAgentRun(result.run_id, {
        onMessage: (message) => {
          setMessages((prev) =>
            prev
              .filter(Boolean)
              .map((msg) =>
                msg.message_id === pendingId
                  ? { ...message, chat_id: chat!.chat_id, status: 'done', pending: false }
                  : msg,
              ),
          )
          setSending(false)
        },
        onStatus: (status) => {
          if (status === 'failed') {
            setMessages((prev) =>
              prev
                .filter(Boolean)
                .map((msg) =>
                  msg.message_id === pendingId
                    ? {
                        ...msg,
                        content: 'The agent run failed. Please try again.',
                        status: 'failed',
                        pending: false,
                      }
                    : msg,
                ),
            )
            setSending(false)
            return
          }

          if (status === 'done') {
            window.setTimeout(() => {
              setMessages((prev) => {
                const stillPending = prev.some((msg) => msg?.message_id === pendingId)
                if (!stillPending || !selectedBatch) return prev
                void listMessages(selectedBatch.id, chat!.chat_id)
                  .then(setMessages)
                  .catch(console.error)
                  .finally(() => setSending(false))
                return prev
              })
            }, 1500)
          }
        },
        onError: (error) => {
          console.error(error)
        },
      })
      runFallbackTimerRef.current = window.setTimeout(() => {
        setMessages((prev) =>
          prev
            .filter(Boolean)
            .map((msg) =>
              msg.message_id === pendingId
                ? {
                    ...msg,
                    content: 'Still working. The live update stream is not connected yet.',
                  }
                : msg,
            ),
        )
        setSending(false)
      }, 30000)

      if (chat.title === 'New Chat') {
        const newTitle = content.slice(0, 50)
        void updateChatTitle(selectedBatch.id, chat.chat_id, newTitle).then(() => {
          setChats((prev) =>
            prev.map((c) => (c.chat_id === chat!.chat_id ? { ...c, title: newTitle } : c)),
          )
          setActiveChat((prev) => (prev ? { ...prev, title: newTitle } : prev))
        })
      }
    } catch (err) {
      console.error(err)
      const errMsg: ChatMessage = {
        message_id: crypto.randomUUID(),
        chat_id: chat.chat_id,
        role: 'assistant',
        content: connectorErrorMessage(err),
        created_at: new Date().toISOString(),
      }
      setMessages((prev) => [...prev, errMsg])
      setSending(false)
    }
  }

  useEffect(() => {
    if (!activeChat || !pendingInitialMessageRef.current || messagesLoading) return
    const message = pendingInitialMessageRef.current
    pendingInitialMessageRef.current = null
    void handleSend(message)
  }, [activeChat, messagesLoading, messages])

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
    if (activeChat?.chat_id === renamingId) {
      setActiveChat((prev) => (prev ? { ...prev, title } : prev))
    }
    setRenamingId(null)
  }

  async function handleDeleteChat(chat: Chat) {
    if (!selectedBatch) return
    if (!window.confirm(`Delete "${chat.title}"?`)) return
    await deleteChat(selectedBatch.id, chat.chat_id).catch(console.error)
    setChats((prev) => prev.filter((c) => c.chat_id !== chat.chat_id))
    if (activeChat?.chat_id === chat.chat_id) {
      setActiveChat(null)
      setMessages([])
    }
    emitChatCreated()
  }

  const showWelcome =
    !!selectedBatch &&
    !!activeChat &&
    messages.length === 0 &&
    !messagesLoading &&
    !sending

  const inputDisabled = !selectedBatch || sending

  return {
    batches,
    batchesLoading,
    selectedBatch,
    setSelectedBatch,
    chats,
    chatsLoading,
    renamingId,
    setRenamingId,
    renameValue,
    setRenameValue,
    activeChat,
    setActiveChat,
    messages,
    messagesLoading,
    input,
    setInput,
    sending,
    currentRunId,
    inputDisabled,
    messagesEndRef,
    textareaRef,
    renameInputRef,
    handleNewChat,
    handleSend,
    handleInputKeyDown,
    handleTextareaInput,
    startRename,
    commitRename,
    handleDeleteChat,
    showWelcome,
    connectors,
    setConnectors,
  }
}

export type ChatPageState = ReturnType<typeof useChatPage>
