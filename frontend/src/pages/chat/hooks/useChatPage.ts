import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type KeyboardEvent,
  type SetStateAction,
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
import {
  subscribeAgentRun,
  type AgentRunEvent,
  type AgentRunStatus,
  type AgentRunStep,
} from '../../../services/agentRunStream'
import { checkGoogleAuthStatus } from '../../../services/authService'
import { emitChatCreated } from '../../../utils/chatEvents'
import type { RunUiState } from '../runTypes'

type ChatLocationState = {
  batchId?: string
  chatId?: string
  initialMessage?: string
}

type ConnectorsState = {
  web_search: boolean
  google_workspace: boolean
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
  const runPollIntervalRef = useRef<number | null>(null)
  const googleWorkspaceManuallyDisabledRef = useRef(false)

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
  const [runStates, setRunStates] = useState<Record<string, RunUiState>>({})

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const renameInputRef = useRef<HTMLInputElement>(null)
  
  const [connectors, setConnectors] = useState<ConnectorsState>({
    web_search: true,
    google_workspace: false,
  })

  const updateConnectors: Dispatch<SetStateAction<ConnectorsState>> = useCallback((value) => {
    setConnectors((prev) => {
      const next = typeof value === 'function' ? value(prev) : value
      if (prev.google_workspace && !next.google_workspace) {
        googleWorkspaceManuallyDisabledRef.current = true
      }
      if (!prev.google_workspace && next.google_workspace) {
        googleWorkspaceManuallyDisabledRef.current = false
      }
      return next
    })
  }, [])

  useEffect(() => {
    if (!user) return
    let cancelled = false

    checkGoogleAuthStatus()
      .then((status) => {
        if (cancelled) return
        const hasValidGoogle = status.valid && status.has_google_scopes
        setConnectors((prev) => ({
          ...prev,
          google_workspace:
            hasValidGoogle && !googleWorkspaceManuallyDisabledRef.current,
        }))
      })
      .catch((err) => {
        console.error(err)
        if (cancelled) return
        setConnectors((prev) => ({ ...prev, google_workspace: false }))
      })

    return () => {
      cancelled = true
    }
  }, [user])

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
    if (!activeChat?.active_run_id || !selectedBatch || messagesLoading) return
    const runId = activeChat.active_run_id
    const pendingId = `pending-${runId}`
    const batchId = selectedBatch.id
    const chatId = activeChat.chat_id

    setCurrentRunId(runId)
    setRunStates((prev) => ({
      ...prev,
      [runId]: prev[runId] || {
        status: 'running',
        events: [],
        steps: {},
        liveConnected: true,
      },
    }))
    setMessages((prev) => {
      if (prev.some((msg) => msg.message_id === pendingId || msg.run_id === runId)) {
        return prev
      }
      return [
        ...prev,
        {
          message_id: pendingId,
          chat_id: chatId,
          role: 'assistant',
          content: 'Working...',
          created_at: new Date().toISOString(),
          status: 'pending',
          run_id: runId,
          pending: true,
        },
      ]
    })

    runUnsubscribeRef.current?.()
    stopFallbackPolling()
    runUnsubscribeRef.current = subscribeAgentRun(runId, {
      onMessage: (message) => {
        upsertLiveAssistantMessage(message, pendingId, chatId)
        setSending(false)
        stopFallbackPolling()
      },
      onStatus: (status) => {
        updateRunStatus(runId, status)
        if (status === 'done') {
          void pollFinalMessagesOnce(batchId, chatId, runId, pendingId)
            .finally(() => setSending(false))
        }
        if (status === 'failed') {
          setSending(false)
        }
      },
      onEvent: (event) => appendRunEvent(runId, event),
      onStep: (step) => upsertRunStep(runId, step),
      onRunError: (message) => updateRunError(runId, message),
      onDisconnected: (connected) => updateRunConnection(runId, connected),
      onError: (error) => {
        console.error(error)
        updateRunStreamError(runId, 'Live updates are delayed. The run is still active.')
        startFallbackPolling(batchId, chatId, runId, pendingId)
      },
    })
  }, [activeChat, selectedBatch, messagesLoading])

  useEffect(() => {
    return () => {
      runUnsubscribeRef.current?.()
      if (runFallbackTimerRef.current) {
        window.clearTimeout(runFallbackTimerRef.current)
      }
      if (runPollIntervalRef.current) {
        window.clearInterval(runPollIntervalRef.current)
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
    const batchId = selectedBatch.id
    const chatId = chat.chat_id

    setInput('')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
    setSending(true)

    const optimisticUser: ChatMessage = {
      message_id: crypto.randomUUID(),
      chat_id: chatId,
      role: 'user',
      content,
      created_at: new Date().toISOString(),
    }
    setMessages((prev) => [...prev, optimisticUser])

    try {
      const result = await sendMessage(
        batchId,
        chatId,
        content,
        connectors,
      )
      const pendingId = `pending-${result.run_id}`
      setCurrentRunId(result.run_id)
      setRunStates((prev) => ({
        ...prev,
        [result.run_id]: {
          status: 'running',
          events: [],
          steps: {},
          liveConnected: true,
        },
      }))
      setMessages((prev) => [
        ...prev.filter(Boolean),
        {
          message_id: pendingId,
          chat_id: chatId,
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
      stopFallbackPolling()
      runUnsubscribeRef.current = subscribeAgentRun(result.run_id, {
        onMessage: (message) => {
          upsertLiveAssistantMessage(message, pendingId, chatId)
          setSending(false)
          stopFallbackPolling()
        },
        onStatus: (status) => {
          updateRunStatus(result.run_id, status)
          if (status === 'failed') {
            setMessages((prev) =>
              prev
                .filter(Boolean)
                .map((msg) =>
                  msg.message_id === pendingId
                    ? {
                        ...msg,
                        content: msg.content || 'The agent run failed before producing a final response.',
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
              void pollFinalMessagesOnce(batchId, chatId, result.run_id, pendingId)
                .finally(() => setSending(false))
            }, 1500)
          }
        },
        onEvent: (event) => appendRunEvent(result.run_id, event),
        onStep: (step) => upsertRunStep(result.run_id, step),
        onRunError: (message) => updateRunError(result.run_id, message),
        onDisconnected: (connected) => updateRunConnection(result.run_id, connected),
        onError: (error) => {
          console.error(error)
          updateRunStreamError(
            result.run_id,
            'Live updates are delayed. The run is still active.',
          )
          startFallbackPolling(batchId, chatId, result.run_id, pendingId)
        },
      })
      runFallbackTimerRef.current = window.setTimeout(() => {
        updateRunStreamError(
          result.run_id,
          'Live updates are delayed. The run is still active.',
        )
        startFallbackPolling(batchId, chatId, result.run_id, pendingId)
      }, 30000)

      if (chat.title === 'New Chat') {
        const newTitle = content.slice(0, 50)
        void updateChatTitle(batchId, chatId, newTitle).then(() => {
          setChats((prev) =>
            prev.map((c) => (c.chat_id === chatId ? { ...c, title: newTitle } : c)),
          )
          setActiveChat((prev) => (prev ? { ...prev, title: newTitle } : prev))
        })
      }
    } catch (err) {
      console.error(err)
      const errMsg: ChatMessage = {
        message_id: crypto.randomUUID(),
        chat_id: chatId,
        role: 'assistant',
        content: connectorErrorMessage(err),
        created_at: new Date().toISOString(),
      }
      setMessages((prev) => [...prev, errMsg])
      setSending(false)
    }
  }

  function updateRunStatus(runId: string, status: AgentRunStatus) {
    setRunStates((prev) => ({
      ...prev,
      [runId]: {
        ...(prev[runId] || { events: [], steps: {} }),
        status,
      },
    }))
  }

  function appendRunEvent(runId: string, event: AgentRunEvent) {
    setRunStates((prev) => {
      const current = prev[runId] || { status: 'running' as AgentRunStatus, events: [], steps: {} }
      const events = current.events.some((item) => item.event_id === event.event_id)
        ? current.events
        : [...current.events, event].sort(
            (a, b) => (a.created_at || 0) - (b.created_at || 0) || a.event_id.localeCompare(b.event_id),
          )
      return { ...prev, [runId]: { ...current, events } }
    })
  }

  function upsertRunStep(runId: string, step: AgentRunStep) {
    setRunStates((prev) => {
      const current = prev[runId] || { status: 'running' as AgentRunStatus, events: [], steps: {} }
      return {
        ...prev,
        [runId]: {
          ...current,
          steps: { ...current.steps, [step.step_id]: step },
        },
      }
    })
  }

  function updateRunStreamError(runId: string, streamError: string) {
    setRunStates((prev) => {
      const current = prev[runId] || { status: 'running' as AgentRunStatus, events: [], steps: {} }
      return { ...prev, [runId]: { ...current, streamError } }
    })
  }

  function updateRunError(runId: string, runError: string) {
    setRunStates((prev) => {
      const current = prev[runId] || { status: 'running' as AgentRunStatus, events: [], steps: {} }
      return { ...prev, [runId]: { ...current, runError } }
    })
  }

  function updateRunConnection(runId: string, liveConnected: boolean) {
    setRunStates((prev) => {
      const current = prev[runId] || { status: 'running' as AgentRunStatus, events: [], steps: {} }
      return { ...prev, [runId]: { ...current, liveConnected } }
    })
  }

  function upsertLiveAssistantMessage(
    message: Omit<ChatMessage, 'chat_id'>,
    pendingId: string,
    chatId: string,
  ) {
    setMessages((prev) => {
      const finalMessage: ChatMessage = {
        ...message,
        chat_id: chatId,
        status: 'done',
        pending: false,
      }
      const existingIndex = prev.findIndex((msg) => msg?.message_id === finalMessage.message_id)
      if (existingIndex >= 0) {
        return prev.map((msg, index) => (index === existingIndex ? finalMessage : msg))
      }
      return prev
        .filter(Boolean)
        .map((msg) =>
          msg.message_id === pendingId || (msg.pending && msg.run_id === message.run_id)
            ? finalMessage
            : msg,
        )
    })
  }

  async function pollFinalMessagesOnce(
    batchId: string,
    chatId: string,
    runId: string,
    pendingId: string,
  ) {
    const data = await listMessages(batchId, chatId)
    setMessages((prev) => mergePolledMessages(prev, data, runId, pendingId))
  }

  function startFallbackPolling(
    batchId: string,
    chatId: string,
    runId: string,
    pendingId: string,
  ) {
    if (runPollIntervalRef.current) {
      window.clearInterval(runPollIntervalRef.current)
    }
    const startedAt = Date.now()
    runPollIntervalRef.current = window.setInterval(() => {
      void pollFinalMessagesOnce(batchId, chatId, runId, pendingId)
        .then(() => {
          if (Date.now() - startedAt > 5 * 60_000) {
            stopFallbackPolling()
            setSending(false)
          }
        })
        .catch(console.error)
    }, 5000)
  }

  function stopFallbackPolling() {
    if (runPollIntervalRef.current) {
      window.clearInterval(runPollIntervalRef.current)
      runPollIntervalRef.current = null
    }
  }

  function mergePolledMessages(
    previous: ChatMessage[],
    fetched: ChatMessage[],
    runId: string,
    pendingId: string,
  ): ChatMessage[] {
    const pendingIndex = previous.findIndex((msg) => msg.message_id === pendingId)
    if (pendingIndex < 0) return fetched

    const previousAssistantCount = previous.filter(
      (msg) => msg.role === 'assistant' && msg.message_id !== pendingId,
    ).length
    const fetchedAssistant = fetched.filter((msg) => msg.role === 'assistant')
    if (fetchedAssistant.length <= previousAssistantCount) return previous

    stopFallbackPolling()
    setSending(false)
    return fetched.map((msg, index) =>
      msg.role === 'assistant' && index === fetched.length - 1
        ? { ...msg, run_id: runId, status: 'done', pending: false }
        : msg,
    )
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
    runStates,
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
    setConnectors: updateConnectors,
  }
}

export type ChatPageState = ReturnType<typeof useChatPage>
