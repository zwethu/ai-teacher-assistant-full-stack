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
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
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

type RouteHydrationState = 'idle' | 'hydrating' | 'hydrated' | 'invalid'

const STREAM_DELAY_MESSAGE =
  'Live updates are delayed. I will fetch the final response when ready.'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'
const MAX_HISTORICAL_RUN_SUBSCRIPTIONS = 5

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

function collectRunIds(messages: ChatMessage[], activeChat: Chat | null): string[] {
  const runIds = new Set<string>()
  const assistantMsgs = messages.filter((msg) => msg.role === 'assistant')

  assistantMsgs.slice(-MAX_HISTORICAL_RUN_SUBSCRIPTIONS).forEach((msg) => {
    if (msg.run_id) runIds.add(msg.run_id)
  })

  if (activeChat?.active_run_id) {
    runIds.add(activeChat.active_run_id)
  }

  const latestAssistant = assistantMsgs.at(-1)
  if (latestAssistant && !latestAssistant.run_id && activeChat?.last_run_id) {
    runIds.add(activeChat.last_run_id)
  }

  return [...runIds]
}

export function useChatPage() {
  const { user } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  const requestedBatchIdRef = useRef<string | null>(null)
  const requestedChatIdRef = useRef<string | null>(null)
  const routeHydratedRef = useRef(false)
  const routeParamsReadRef = useRef(false)
  const pendingInitialMessageRef = useRef<string | null>(null)
  const runUnsubscribesRef = useRef<Record<string, () => void>>({})
  const runFallbackTimerRef = useRef<number | null>(null)
  const runPollIntervalRef = useRef<Record<string, number>>({})

  const [routeHydration, setRouteHydration] = useState<RouteHydrationState>('idle')
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
  const googleWorkspaceManuallyDisabledRef = useRef(false)

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

  // Read route params once on mount
  useEffect(() => {
    if (routeParamsReadRef.current) return
    routeParamsReadRef.current = true

    const routeState = location.state as ChatLocationState | null
    requestedBatchIdRef.current = routeState?.batchId || searchParams.get('batch')
    requestedChatIdRef.current = routeState?.chatId || searchParams.get('chat')
    pendingInitialMessageRef.current = routeState?.initialMessage ?? null

    if (routeState) {
      navigate(location.pathname + location.search, { replace: true, state: null })
    }
  }, [location.pathname, location.search, location.state, navigate, searchParams])

  // Hydrate batch/chat from URL params
  useEffect(() => {
    const batchId = requestedBatchIdRef.current
    const chatId = requestedChatIdRef.current

    if (!batchId) {
      if (!batchesLoading && !routeHydratedRef.current) {
        routeHydratedRef.current = true
        setRouteHydration('hydrated')
      }
      return
    }

    if (batchesLoading) {
      setRouteHydration('hydrating')
      return
    }

    const batch = batches.find((item) => item.id === batchId)
    if (!batch) {
      if (!routeHydratedRef.current) {
        routeHydratedRef.current = true
        setRouteHydration('invalid')
      }
      return
    }

    if (selectedBatch?.id !== batch.id) {
      setSelectedBatch(batch)
    }

    if (!chatId) {
      if (!routeHydratedRef.current) {
        routeHydratedRef.current = true
        setRouteHydration('hydrated')
      }
      return
    }

    if (chatsLoading) {
      setRouteHydration('hydrating')
      return
    }

    const chat = chats.find((item) => item.chat_id === chatId)
    if (!chat) {
      if (selectedBatch?.id === batch.id && !chatsLoading && !routeHydratedRef.current) {
        routeHydratedRef.current = true
        setRouteHydration('invalid')
      }
      return
    }

    if (activeChat?.chat_id !== chat.chat_id) {
      setActiveChat(chat)
    }

    if (!routeHydratedRef.current) {
      routeHydratedRef.current = true
      setRouteHydration('hydrated')
    }
  }, [
    activeChat?.chat_id,
    batches,
    batchesLoading,
    chats,
    chatsLoading,
    selectedBatch?.id,
  ])

  // Sync state to URL only after hydration completes
  useEffect(() => {
    if (!routeHydratedRef.current || routeHydration === 'hydrating') return

    const waitingForBatch =
      Boolean(requestedBatchIdRef.current) && !selectedBatch && batchesLoading
    const waitingForChat =
      Boolean(requestedChatIdRef.current) &&
      !activeChat &&
      (chatsLoading || Boolean(selectedBatch))

    if (waitingForBatch || waitingForChat) return

    const newParams = new URLSearchParams(searchParams)
    let changed = false

    if (selectedBatch) {
      if (newParams.get('batch') !== selectedBatch.id) {
        newParams.set('batch', selectedBatch.id)
        changed = true
      }
    } else if (newParams.has('batch') && !requestedBatchIdRef.current) {
      newParams.delete('batch')
      changed = true
    }

    if (activeChat) {
      if (newParams.get('chat') !== activeChat.chat_id) {
        newParams.set('chat', activeChat.chat_id)
        changed = true
      }
    } else if (newParams.has('chat') && !requestedChatIdRef.current) {
      newParams.delete('chat')
      changed = true
    }

    if (changed) {
      setSearchParams(newParams, { replace: true })
    }
  }, [activeChat, routeHydration, searchParams, selectedBatch, batchesLoading, chatsLoading, setSearchParams])

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
      .then((data) => {
        const lastRunId = activeChat.last_run_id
        const assistantMsgs = data.filter((msg) => msg.role === 'assistant')
        const latestAssistant = assistantMsgs.at(-1)
        const enriched = data.map((msg) => {
          if (msg.run_id) {
            return msg
          }
          if (
            latestAssistant &&
            msg.message_id === latestAssistant.message_id &&
            lastRunId
          ) {
            return { ...msg, run_id: lastRunId }
          }
          return msg
        })
        setMessages(enriched)
      })
      .catch(console.error)
      .finally(() => setMessagesLoading(false))
  }, [activeChat, selectedBatch])

  function ensureRunState(runId: string, status: AgentRunStatus = 'running') {
    setRunStates((prev) => ({
      ...prev,
      [runId]: prev[runId] || {
        status,
        events: [],
        steps: {},
        liveConnected: true,
      },
    }))
  }

  function ensurePendingAssistantMessage(runId: string, chatId: string) {
    const pendingId = `pending-${runId}`
    setMessages((prev) => {
      if (prev.some((msg) => msg.message_id === pendingId || (msg.pending && msg.run_id === runId))) {
        return prev
      }
      return [
        ...prev,
        {
          message_id: pendingId,
          chat_id: chatId,
          role: 'assistant',
          content: '',
          created_at: new Date().toISOString(),
          status: 'pending',
          run_id: runId,
          pending: true,
        },
      ]
    })
  }

  function subscribeToRun(
    runId: string,
    batchId: string,
    chatId: string,
    options?: { withPolling?: boolean },
  ) {
    if (runUnsubscribesRef.current[runId]) return

    const pendingId = `pending-${runId}`
    ensureRunState(runId)

    runUnsubscribesRef.current[runId] = subscribeAgentRun(runId, {
      onMessage: (message) => {
        upsertLiveAssistantMessage(message, pendingId, chatId)
        setSending(false)
        stopFallbackTimers(runId)
      },
      onStatus: (status) => {
        updateRunStatus(runId, status)
        if (status === 'done') {
          stopFallbackTimers(runId)
          void pollFinalMessagesOnce(batchId, chatId, runId, pendingId).finally(() =>
            setSending(false),
          )
        }
        if (status === 'failed') {
          stopFallbackTimers(runId)
          setMessages((prev) =>
            prev.map((msg) =>
              msg.pending && msg.run_id === runId
                ? { ...msg, content: '', status: 'failed', pending: false }
                : msg,
            ),
          )
          setSending(false)
        }
      },
      onEvent: (event) => appendRunEvent(runId, event),
      onStep: (step) => upsertRunStep(runId, step),
      onRunError: (message) => updateRunError(runId, message),
      onDisconnected: (connected) => updateRunConnection(runId, connected),
      onError: (error) => {
        console.error(error)
        updateRunStreamError(runId, STREAM_DELAY_MESSAGE)
        if (options?.withPolling) {
          startFallbackPolling(batchId, chatId, runId, pendingId)
        }
      },
    })

    if (options?.withPolling) {
      if (runFallbackTimerRef.current) {
        window.clearTimeout(runFallbackTimerRef.current)
      }
      runFallbackTimerRef.current = window.setTimeout(() => {
        updateRunStreamError(runId, STREAM_DELAY_MESSAGE)
        startFallbackPolling(batchId, chatId, runId, pendingId)
      }, 30000)
    }
  }

  function unsubscribeFromRun(runId: string) {
    runUnsubscribesRef.current[runId]?.()
    delete runUnsubscribesRef.current[runId]
    stopFallbackTimers(runId)
  }

  // Subscribe to visible assistant run_ids after messages load
  useEffect(() => {
    if (!activeChat || !selectedBatch || messagesLoading) return

    const batchId = selectedBatch.id
    const chatId = activeChat.chat_id
    const runIds = collectRunIds(messages, activeChat)

    if (activeChat.active_run_id) {
      setCurrentRunId(activeChat.active_run_id)
      ensurePendingAssistantMessage(activeChat.active_run_id, chatId)
      subscribeToRun(activeChat.active_run_id, batchId, chatId, { withPolling: true })
    }

    runIds.forEach((runId) => {
      if (runId === activeChat.active_run_id) return
      ensureRunState(
        runId,
        activeChat.last_run_id === runId
          ? (activeChat.last_run_status as AgentRunStatus) || 'done'
          : 'done',
      )
      subscribeToRun(runId, batchId, chatId)
    })

    for (const subscribedRunId of Object.keys(runUnsubscribesRef.current)) {
      if (!runIds.includes(subscribedRunId)) {
        unsubscribeFromRun(subscribedRunId)
      }
    }
  }, [activeChat, selectedBatch, messages, messagesLoading])

  useEffect(() => {
    return () => {
      Object.keys(runUnsubscribesRef.current).forEach((runId) => {
        unsubscribeFromRun(runId)
      })
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
    requestedBatchIdRef.current = selectedBatch.id
    requestedChatIdRef.current = chat.chat_id
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
      const result = await sendMessage(batchId, chatId, content, connectors)
      const pendingId = `pending-${result.run_id}`
      setCurrentRunId(result.run_id)
      ensureRunState(result.run_id)
      setMessages((prev) => [
        ...prev.filter(Boolean),
        {
          message_id: pendingId,
          chat_id: chatId,
          role: 'assistant',
          content: '',
          created_at: new Date().toISOString(),
          status: 'pending',
          run_id: result.run_id,
          pending: true,
        },
      ])

      unsubscribeFromRun(result.run_id)
      subscribeToRun(result.run_id, batchId, chatId, { withPolling: true })

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
        run_id: message.run_id,
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
    if (runPollIntervalRef.current[runId]) {
      window.clearInterval(runPollIntervalRef.current[runId])
    }
    const startedAt = Date.now()
    runPollIntervalRef.current[runId] = window.setInterval(() => {
      void pollFinalMessagesOnce(batchId, chatId, runId, pendingId)
        .then(() => {
          if (Date.now() - startedAt > 5 * 60_000) {
            stopFallbackTimers(runId)
            setSending(false)
          }
        })
        .catch(console.error)
    }, 5000)
  }

  function stopFallbackPolling(runId?: string) {
    if (runId) {
      if (runPollIntervalRef.current[runId]) {
        window.clearInterval(runPollIntervalRef.current[runId])
        delete runPollIntervalRef.current[runId]
      }
      return
    }
    Object.values(runPollIntervalRef.current).forEach((timer) => {
      window.clearInterval(timer)
    })
    runPollIntervalRef.current = {}
  }

  function stopFallbackTimers(runId?: string) {
    if (!runId || Object.keys(runPollIntervalRef.current).length <= 1) {
      if (runFallbackTimerRef.current) {
        window.clearTimeout(runFallbackTimerRef.current)
        runFallbackTimerRef.current = null
      }
    }
    stopFallbackPolling(runId)
  }

  function mergePolledMessages(
    previous: ChatMessage[],
    fetched: ChatMessage[],
    runId: string,
    pendingId: string,
  ): ChatMessage[] {
    const pendingIndex = previous.findIndex((msg) => msg.message_id === pendingId)
    const hasPending = pendingIndex >= 0

    const previousAssistantCount = previous.filter(
      (msg) => msg.role === 'assistant' && msg.message_id !== pendingId,
    ).length
    const fetchedAssistant = fetched.filter((msg) => msg.role === 'assistant')
    if (hasPending && fetchedAssistant.length <= previousAssistantCount) {
      return previous
    }

    stopFallbackPolling(runId)
    setSending(false)

    if (!hasPending) {
      return fetched.map((msg) =>
        msg.run_id
          ? { ...msg, status: msg.role === 'assistant' ? 'done' : msg.status, pending: false }
          : msg,
      )
    }

    const latestAssistant = fetchedAssistant.at(-1)
    return fetched.map((msg) => {
      if (msg.message_id === latestAssistant?.message_id) {
        return {
          ...msg,
          run_id: msg.run_id || runId,
          status: 'done',
          pending: false,
        }
      }
      if (msg.run_id) {
        return { ...msg, status: msg.role === 'assistant' ? 'done' : msg.status, pending: false }
      }
      return msg
    })
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
      requestedChatIdRef.current = null
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
    setSelectedBatch: (batch: Batch | null) => {
      requestedBatchIdRef.current = batch?.id ?? null
      requestedChatIdRef.current = null
      setSelectedBatch(batch)
    },
    chats,
    chatsLoading,
    renamingId,
    setRenamingId,
    renameValue,
    setRenameValue,
    activeChat,
    setActiveChat: (chat: Chat | null) => {
      requestedChatIdRef.current = chat?.chat_id ?? null
      setActiveChat(chat)
    },
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
