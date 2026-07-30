import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type ChangeEvent,
  type ClipboardEvent,
  type KeyboardEvent,
  type SetStateAction,
} from 'react'
import axios from 'axios'
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import type { Batch } from '../../../entity/Batch'
import type { Chat, ChatAttachment, ChatAttachmentListItem, ChatMessage } from '../../../entity/Chat'
import { useAuth } from '../../../hooks/useAuth'
import { getBatchById, listBatches } from '../../../services/batchService'
import {
  createChat,
  deleteChat,
  getChat,
  getChatRun,
  getChatAttachmentRagStatus,
  listChats,
  listMessages,
  sendMessage,
  uploadChatAttachment,
  deleteChatAttachment,
  cancelChatRun,
  deleteMessage,
  updateChatTitle,
  type ChatRunRecord,
} from '../../../services/chatService'
import { generateAssessment, generateLab, generateLessonPlan, invokeAgent } from '../../../services/agentService'
import {
  subscribeAgentRun,
  type AgentRunDelta,
  type AgentRunEvent,
  type AgentRunStatus,
  type AgentRunStep,
  type AgentRunStreamMeta,
} from '../../../services/agentRunStream'
import {
  subscribeChatAttachments,
  type ChatAttachmentStatusEvent,
} from '../../../services/chatAttachmentStream'
import { createStallWatchdog } from '../../../hooks/streamStallWatchdog'
import { formatQuoteMention } from '../components/MessageRow'
import { emitChatCreated } from '../../../utils/chatEvents'
import type { RunUiState } from '../runTypes'
import type { GenerateMode } from '../components/ChatConversation'
import { buildGenerationRequest } from '../generationRequest'

type ChatLocationState = {
  batchId?: string
  chatId?: string
  initialMessage?: string
  /** Composer state chosen on the surface that started the chat. */
  webSearch?: boolean
  generateMode?: GenerateMode | null
  /** Already uploaded into the new chat, to be sent with the first message. */
  attachmentIds?: string[]
}

type ConnectorsState = {
  web_search: boolean
}

type RouteHydrationState = 'idle' | 'hydrating' | 'hydrated' | 'invalid'
type StartRunResult = {
  run_id: string
  chat_id?: string
  rtdb_run_path?: string
  status: 'awaiting_attachments' | 'running' | 'done' | 'failed'
  user_message?: ChatMessage
}

export type PendingChatAttachment = ChatAttachment & { previewUrl?: string }

const STREAM_DELAY_MESSAGE =
  'Live updates are delayed. I will fetch the final response when ready.'

const MAX_HISTORICAL_RUN_SUBSCRIPTIONS = 5

/** Backstop cadence for attachment readiness. RTDB carries the fast path; this only
 *  catches the case where the live channel is unconfigured or unreachable. */
const ATTACHMENT_FALLBACK_POLL_MS = 10_000

function connectorErrorMessage(err: unknown): string {
  if (!axios.isAxiosError(err)) {
    return 'Sorry, something went wrong. Please try again.'
  }

  const detail = err.response?.data?.detail
  const message = typeof detail?.message === 'string' ? detail.message : ''

  return message || 'Sorry, something went wrong. Please try again.'
}

function titleFromMessage(content: string): string {
  const trimmed = content.trim()
  if (!trimmed) return 'New Chat'
  if (trimmed.length <= 50) return trimmed

  const prefix = trimmed.slice(0, 50).trimEnd()
  const lastSpace = prefix.lastIndexOf(' ')
  const title = lastSpace > 0 ? prefix.slice(0, lastSpace) : prefix
  return `${title}...`
}

function chatPath(batchId: string, chatId: string): string {
  return `/batches/${batchId}/chats/${chatId}`
}

function enrichMessages(data: ChatMessage[], chat: Chat): ChatMessage[] {
  const lastRunId = chat.last_run_id
  const assistantMsgs = data.filter((msg) => msg.role === 'assistant')
  const latestAssistant = assistantMsgs.at(-1)
  return data.map((msg) => {
    if (msg.run_id) return msg
    if (
      latestAssistant &&
      msg.message_id === latestAssistant.message_id &&
      lastRunId
    ) {
      return { ...msg, run_id: lastRunId }
    }
    return msg
  })
}

/**
 * True when a run already owns an assistant message, settled or still pending.
 *
 * The placeholder must not be re-added for a run that has already answered.
 * Checking only for a *pending* message missed the settled case: after a retry
 * the chat's cached `active_run_id` still names the finished run, so every
 * re-render appended a second, empty assistant row — which rendered as a
 * detached "Completed N steps" / "Thought for Xs" block under the real answer.
 */
/**
 * Messages the client holds that server truth will not contain, and which a
 * poll must therefore not delete.
 *
 * Two kinds qualify:
 *  - still streaming — a retry leaves the previous run's poll alive briefly, and
 *    the server cannot yet know about the reply arriving right now.
 *  - cancelled — a stopped run persists nothing, so the "You stopped this
 *    request" record exists only here. It is deliberately not `pending`
 *    (cancelling settles it), so it has to be named explicitly.
 */
export function localOnlyMessages(previous: ChatMessage[], fetched: ChatMessage[]): ChatMessage[] {
  const fetchedIds = new Set(fetched.map((item) => item.message_id))
  return previous.filter(
    (msg) =>
      (msg.pending || msg.metadata?.run_cancelled === true) && !fetchedIds.has(msg.message_id),
  )
}

/**
 * Assemble what actually gets sent.
 *
 * Message `content` is the only channel the agent reads — `agent_gateway`
 * stashes this exact string and replays it to Agent Engine, and message
 * metadata is never forwarded. So a quoted passage and any re-referenced
 * attachments have to travel inside it, and the renderer strips them back out
 * for display (see parseUserMessageContent).
 *
 * The quote leads: it is the thing the rest of the message is about.
 *
 * Exported so the composition can be tested without standing up the whole hook
 * — this is the step where a quote would silently fail to reach the agent.
 */
export function composeOutgoingMessage({
  typed,
  quote,
  references,
  hasAttachments,
}: {
  typed: string
  quote: string
  references: { attachment_id: string; file_title?: string; file_name?: string }[]
  hasAttachments: boolean
}): { body: string; content: string } {
  const refMentions = references
    .map((item) => `Please use the earlier attachment ${item.file_title || item.file_name}. Attachment ID: ${item.attachment_id}`)
    .join('\n')
  const quoteMention = quote ? formatQuoteMention(quote) : ''
  // A quote or an attachment alone still needs something to act on; the stock
  // line is what makes "send with only a file attached" a valid request.
  const body = typed || (hasAttachments ? 'Please review the attached file(s).' : '')
  return { body, content: [quoteMention, body, refMentions].filter(Boolean).join('\n\n') }
}

export function runHasAssistantMessage(messages: ChatMessage[], runId: string): boolean {
  const pendingId = `pending-${runId}`
  return messages.some(
    (msg) =>
      msg.message_id === pendingId || (msg.role === 'assistant' && msg.run_id === runId),
  )
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
  const [searchParams] = useSearchParams()
  const { batchId: routeBatchId, chatId: routeChatId } = useParams()

  const pendingInitialMessageRef = useRef<string | null>(null)
  const pendingInitialAttachmentIdsRef = useRef<string[]>([])
  const runUnsubscribesRef = useRef<Record<string, () => void>>({})
  const runDeltaIndexesRef = useRef<Record<string, Set<number>>>({})
  // Per-run silence detector for the live channel. Previously a single shared
  // timeout, so two concurrent runs fought over one slot.
  const stallWatchdogRef = useRef(createStallWatchdog())
  const runPollIntervalRef = useRef<Record<string, number>>({})
  const workflowModeRunIdsRef = useRef<Record<string, GenerateMode>>({})
  const scrollFrameRef = useRef<number | null>(null)
  const hydratedRunSnapshotsRef = useRef<Set<string>>(new Set())

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
  const [activeGenerateMode, setActiveGenerateMode] = useState<GenerateMode | null>(null)
  const [sending, setSending] = useState(false)
  const [pendingAttachments, setPendingAttachments] = useState<PendingChatAttachment[]>([])
  // Prior-message attachments the user re-references. These CANNOT go through attachment_ids
  // (the backend rejects an already-sent attachment); they are conveyed to the agent as an
  // id mention appended to the message at send time and surfaced here only as composer chips.
  const [referencedAttachments, setReferencedAttachments] = useState<ChatAttachmentListItem[]>([])
  // A passage the lecturer selected from an earlier response, pending send.
  const [quotedReply, setQuotedReply] = useState('')
  const [attachmentsUploading, setAttachmentsUploading] = useState(false)
  const [attachmentErrors, setAttachmentErrors] = useState<string[]>([])
  const [currentRunId, setCurrentRunId] = useState<string | null>(null)
  const [runStates, setRunStates] = useState<Record<string, RunUiState>>({})

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const renameInputRef = useRef<HTMLInputElement>(null)
  // Latest pending (uploaded-but-unsent) attachments, for unmount cleanup.
  // Attachment ids with a DELETE currently in flight, so a repeat click cannot
  // issue a second request before React has dropped the item from state.
  const removingAttachmentIdsRef = useRef<Set<string>>(new Set())
  const [retryingMessageId, setRetryingMessageId] = useState<string | null>(null)
  const [cancelling, setCancelling] = useState(false)
  // Set when Stop is pressed during a retry's pre-run window, where there is
  // no run_id to cancel yet.
  const retryAbortedRef = useRef(false)
  // Runs this client has seen settle. The chat record's cached active_run_id
  // outlives the run, so without this the resubscribe effect below keeps
  // treating a finished run as live every time `messages` changes.
  const settledRunIdsRef = useRef<Set<string>>(new Set())
  const pendingAttachmentsRef = useRef<PendingChatAttachment[]>([])
  useEffect(() => { pendingAttachmentsRef.current = pendingAttachments }, [pendingAttachments])

  useEffect(() => {
    const batchId = selectedBatch?.id
    const chatId = activeChat?.chat_id
    // Native-first: readiness is the single `status` field.
    const transitional = pendingAttachments.filter((item) => item.status === 'processing')
    if (!batchId || !chatId || transitional.length === 0) return
    let cancelled = false
    const apply = (update: ChatAttachmentStatusEvent) => {
      if (cancelled) return
      setPendingAttachments((current) => current.map((item) =>
        item.attachment_id === update.attachment_id ? { ...item, ...update } : item))
    }

    // Push. The backend mirrors every status transition, and onChildAdded replays
    // whatever is already there, so the current state arrives without asking.
    const unsubscribe = subscribeChatAttachments(chatId, { onStatus: apply })

    // Pull, as a safety net only — RTDB is best-effort and goes quietly unused
    // when FIREBASE_RTDB_URL is unset. Deliberately slow: this exists so the
    // composer cannot hang, not to drive the UI.
    const refresh = async () => {
      const updates = await Promise.all(transitional.map(async (item) => {
        try { return await getChatAttachmentRagStatus(batchId, chatId, item.attachment_id) }
        catch { return null }
      }))
      if (cancelled) return
      updates.forEach((update) => { if (update) apply(update) })
    }
    const timer = window.setInterval(() => void refresh(), ATTACHMENT_FALLBACK_POLL_MS)
    return () => { cancelled = true; unsubscribe(); window.clearInterval(timer) }
  }, [selectedBatch?.id, activeChat?.chat_id, pendingAttachments.map((item) => `${item.attachment_id}:${item.status}`).join('|')])

  const [connectors, setConnectors] = useState<ConnectorsState>({
    web_search: true,
  })

  const updateConnectors: Dispatch<SetStateAction<ConnectorsState>> = useCallback((value) => {
    setConnectors((prev) => {
      const next = typeof value === 'function' ? value(prev) : value
      return next
    })
  }, [])

  useEffect(() => {
    if (!user) return
    setBatchesLoading(true)
    listBatches()
      .then((data) => setBatches(data))
      .catch(console.error)
      .finally(() => setBatchesLoading(false))
  }, [user])

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

  const selectChat = useCallback(
    (chat: Chat) => {
      navigate(chatPath(chat.batch_id, chat.chat_id))
    },
    [navigate],
  )

  // Capture one-shot initialMessage from navigation state
  useEffect(() => {
    const routeState = location.state as ChatLocationState | null
    if (!routeState?.initialMessage) return
    pendingInitialMessageRef.current = routeState.initialMessage
    pendingInitialAttachmentIdsRef.current = routeState.attachmentIds ?? []
    // Safe to set here rather than race the send: this effect runs on mount,
    // while the send waits for the chat and its messages to finish loading.
    if (typeof routeState.webSearch === 'boolean') {
      setConnectors((prev) => ({ ...prev, web_search: routeState.webSearch as boolean }))
    }
    if (routeState.generateMode) setActiveGenerateMode(routeState.generateMode)
    navigate(location.pathname, { replace: true, state: null })
  }, [location.pathname, location.state, navigate])

  // Redirect legacy location.state / query URLs to canonical routes
  useEffect(() => {
    if (routeBatchId && routeChatId) return

    const routeState = location.state as ChatLocationState | null
    if (routeState?.batchId && routeState?.chatId) {
      pendingInitialMessageRef.current = routeState.initialMessage ?? null
      navigate(chatPath(routeState.batchId, routeState.chatId), { replace: true, state: null })
      return
    }

    const paramBatch = searchParams.get('batch')
    const paramChat = searchParams.get('chat')
    if (paramBatch && paramChat) {
      navigate(chatPath(paramBatch, paramChat), { replace: true })
    }
  }, [routeBatchId, routeChatId, location.state, navigate, searchParams])

  // Canonical route: load batch + chat + messages from backend
  useEffect(() => {
    if (!routeBatchId || !routeChatId || !user) return

    let cancelled = false

    async function hydrateFromRoute() {
      setRouteHydration('hydrating')
      setMessagesLoading(true)

      try {
        const batch = await getBatchById(routeBatchId!)
        if (cancelled) return
        if (!batch) {
          setRouteHydration('invalid')
          return
        }

        const chat = await getChat(routeBatchId!, routeChatId!)
        if (cancelled) return

        setSelectedBatch(batch)
        setActiveChat(chat)
        setChats((prev) => {
          const exists = prev.some((item) => item.chat_id === chat.chat_id)
          if (exists) {
            return prev.map((item) => (item.chat_id === chat.chat_id ? chat : item))
          }
          return [chat, ...prev]
        })

        const data = await listMessages(routeBatchId!, routeChatId!)
        if (cancelled) return

        setMessages((prev) => {
          if (prev.length > 0 && prev.every((msg) => msg.chat_id === chat.chat_id)) {
            return prev
          }
          return enrichMessages(data, chat)
        })
        setRouteHydration('hydrated')
      } catch (err) {
        console.error(err)
        if (!cancelled) setRouteHydration('invalid')
      } finally {
        if (!cancelled) setMessagesLoading(false)
      }

      if (!cancelled) {
        void loadChats(routeBatchId!)
      }
    }

    void hydrateFromRoute()
    return () => {
      cancelled = true
    }
  }, [routeBatchId, routeChatId, user, loadChats])

  // Plain /chat: no active conversation in the URL
  useEffect(() => {
    if (routeBatchId && routeChatId) return

    setActiveChat(null)
    setMessages([])
    setRouteHydration('idle')
  }, [routeBatchId, routeChatId])

  useEffect(() => {
    if (!selectedBatch) {
      setChats([])
      return
    }
    if (routeBatchId && routeChatId && routeHydration === 'hydrating') return
    void loadChats(selectedBatch.id)
  }, [selectedBatch, loadChats, routeBatchId, routeChatId, routeHydration])

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

  function hydrateDurableRunState(runId: string, record: ChatRunRecord) {
    const snapshot = record.timeline_snapshot
    setRunStates((prev) => {
      const current = prev[runId] || {
        status: record.status || 'done', events: [], steps: {}, liveConnected: true,
      }
      if (!snapshot) return { ...prev, [runId]: { ...current, status: record.status || current.status } }
      const eventsById = new Map<string, AgentRunEvent>()
      for (const event of [...(snapshot.events || []), ...current.events]) {
        eventsById.set(event.event_id, event)
      }
      const events = [...eventsById.values()].sort(
        (a, b) => Number(a.created_at || 0) - Number(b.created_at || 0),
      )
      return {
        ...prev,
        [runId]: {
          ...current,
          status: record.status || snapshot.status || current.status,
          events,
          steps: { ...(snapshot.steps || {}), ...current.steps },
        },
      }
    })
  }

  function ensurePendingAssistantMessage(runId: string, chatId: string) {
    const pendingId = `pending-${runId}`
    setMessages((prev) => {
      if (runHasAssistantMessage(prev, runId)) return prev
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

    // Any inbound signal means the live channel is working, so push the stall
    // deadline back rather than letting the one-shot timer fire mid-run.
    const alive = () => {
      if (!options?.withPolling) return
      armStallWatchdog(batchId, chatId, runId, pendingId)
    }

    runUnsubscribesRef.current[runId] = subscribeAgentRun(runId, {
      onMessage: (message) => {
        upsertLiveAssistantMessage(message, pendingId, chatId)
        setSending(false)
        stopFallbackTimers(runId)
      },
      onStatus: (status) => {
        updateRunStatus(runId, status)
        if (status === 'running' || status === 'awaiting_attachments') alive()
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
        if (status === 'cancelled') {
          // Reaches this client on a reload, or in a second tab — the tab that
          // pressed Stop has already unsubscribed. Settle the same way it does,
          // so the composer never stays stuck in "sending".
          stopFallbackTimers(runId)
          settledRunIdsRef.current.add(runId)
          setMessages((prev) =>
            prev.map((msg) =>
              msg.message_id === pendingId || (msg.pending && msg.run_id === runId)
                ? {
                    ...msg,
                    pending: false,
                    status: 'done' as const,
                    metadata: { ...(msg.metadata || {}), run_cancelled: true },
                  }
                : msg,
            ),
          )
          setSending(false)
        }
      },
      onEvent: (event) => { alive(); appendRunEvent(runId, event) },
      onStep: (step) => { alive(); upsertRunStep(runId, step) },
      onDelta: (delta) => { alive(); appendRunDelta(runId, delta, chatId, pendingId) },
      onStreamMeta: (meta) => updateRunStreamMeta(runId, meta),
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

    if (options?.withPolling) armStallWatchdog(batchId, chatId, runId, pendingId)
  }

  function unsubscribeFromRun(runId: string) {
    runUnsubscribesRef.current[runId]?.()
    delete runUnsubscribesRef.current[runId]
    delete runDeltaIndexesRef.current[runId]
    delete workflowModeRunIdsRef.current[runId]
    stopFallbackTimers(runId)
  }

  // Subscribe to visible assistant run_ids after messages load
  useEffect(() => {
    if (!activeChat || !selectedBatch || messagesLoading) return

    const batchId = selectedBatch.id
    const chatId = activeChat.chat_id
    const runIds = collectRunIds(messages, activeChat)

    // active_run_id is the chat record's cached value and is NOT cleared when a
    // run ends, so it alone cannot mean "still running". This effect re-runs on
    // every `messages` change — including the ones cancelling produces — and
    // without the settled check it re-armed the composer's Stop button and
    // resubscribed the run the user had just stopped.
    if (activeChat.active_run_id && !settledRunIdsRef.current.has(activeChat.active_run_id)) {
      setCurrentRunId(activeChat.active_run_id)
      // The run outlives the page: after a reload it is still streaming, so the
      // composer has to come back as Stop rather than Send. subscribeToRun's
      // status handlers clear this again when the run settles.
      setSending(true)
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

  // Rehydrate every historical message timeline from the durable Firestore run
  // snapshot. The run endpoint backfills older records from RTDB once when possible.
  useEffect(() => {
    if (!activeChat || !selectedBatch || messagesLoading) return
    const runIds = [...new Set(
      messages
        .filter((message) => message.role === 'assistant' && message.run_id)
        .map((message) => String(message.run_id)),
    )]
    for (const runId of runIds) {
      if (hydratedRunSnapshotsRef.current.has(runId)) continue
      hydratedRunSnapshotsRef.current.add(runId)
      void getChatRun(selectedBatch.id, activeChat.chat_id, runId)
        .then((record) => hydrateDurableRunState(runId, record))
        .catch((error) => {
          hydratedRunSnapshotsRef.current.delete(runId)
          console.error(error)
        })
    }
  }, [activeChat, selectedBatch, messages, messagesLoading])

  useEffect(() => {
    return () => {
      Object.keys(runUnsubscribesRef.current).forEach((runId) => {
        unsubscribeFromRun(runId)
      })
      stopFallbackTimers()
      if (scrollFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollFrameRef.current)
      }
      // Reap uploaded-but-unsent attachments so abandoning the composer does
      // not orphan GCS objects + Firestore docs (fire-and-forget).
      pendingAttachmentsRef.current.forEach((item) => {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl)
        void deleteChatAttachment(item.batch_id, item.chat_id, item.attachment_id).catch(() => {})
      })
    }
  }, [])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length, sending])

  function scrollToBottom(behavior: ScrollBehavior = 'smooth') {
    if (scrollFrameRef.current !== null) {
      window.cancelAnimationFrame(scrollFrameRef.current)
    }
    scrollFrameRef.current = window.requestAnimationFrame(() => {
      scrollFrameRef.current = null
      messagesEndRef.current?.scrollIntoView({ behavior, block: 'end' })
    })
  }

  function anchorToBottomDuringLiveUpdate() {
    scrollToBottom('auto')
  }

  async function handleNewChat(title = 'New Chat') {
    if (!selectedBatch) return null
    const chat = await createChat(selectedBatch.id, title)
    setChats((prev) => [chat, ...prev])
    emitChatCreated()
    navigate(chatPath(selectedBatch.id, chat.chat_id))
    return chat
  }

  async function handleSend(text?: string, overrides?: { attachmentIds?: string[] }) {
    const typedContent = (text ?? input).trim()
    const carriedAttachmentIds = overrides?.attachmentIds ?? []
    const { body: base, content } = composeOutgoingMessage({
      typed: typedContent,
      quote: quotedReply,
      references: referencedAttachments,
      hasAttachments: pendingAttachments.length > 0 || carriedAttachmentIds.length > 0,
    })
    if (!base || !selectedBatch || sending || attachmentsUploading) return

    let chat = activeChat
    if (!chat) {
      chat = await handleNewChat(titleFromMessage(content))
      if (!chat) return
    }
    const batchId = selectedBatch.id
    const chatId = chat.chat_id
    const attachmentsForMessage = [...pendingAttachments]
    const attachmentIds = carriedAttachmentIds.length
      ? carriedAttachmentIds
      : attachmentsForMessage.map((item) => item.attachment_id)

    const referencedForMessage = [...referencedAttachments]
    const quotedReplyForMessage = quotedReply

    // Empty the composer NOW, not when the run starts. `startRunInChat` awaits
    // the POST that creates the message, so clearing afterwards left the text
    // and attachment tiles sitting there — disabled — for the whole round trip,
    // which reads as the composer having frozen. The optimistic user message is
    // already on screen by then, so the composer has nothing left to hold.
    setInput('')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
    setPendingAttachments([])
    setReferencedAttachments([])
    setQuotedReply('')
    setAttachmentErrors([])
    const generateMode = activeGenerateMode
    const started = await startRunInChat({
      batchId,
      chat,
      message: content,
      invoke: async () => {
        // Email has no outline/preview stage: it routes through plain chat so the
        // backend's pending-email staging (which only runs when pending_artifact is
        // unset) can stage the draft for the Send/Schedule buttons.
        if (!generateMode || generateMode === 'email') {
          // Email drafting never uses web search — force it off so the hidden
          // toggle's default `web_search: true` can't reach the backend.
          const chatConnectors =
            generateMode === 'email' ? { ...connectors, web_search: false } : connectors
          return sendMessage(batchId, chatId, content, chatConnectors, attachmentIds)
        }
        const payload = buildGenerationRequest(
          generateMode, batchId, chatId, content, connectors, attachmentIds,
        )
        const result = generateMode === 'course_blueprint' || generateMode === 'game'
          ? await invokeAgent(payload)
          : generateMode === 'lab'
          ? await generateLab('', payload)
          : generateMode === 'assessment'
            ? await generateAssessment('', payload)
            : await generateLessonPlan('', payload)
        return result as StartRunResult
      },
      updateTitleIfNew: true,
      workflowMode: generateMode,
      attachmentSnapshots: attachmentsForMessage,
    })
    if (started) {
      attachmentsForMessage.forEach((item) => item.previewUrl && URL.revokeObjectURL(item.previewUrl))
    } else {
      // The send failed, so give the composer its contents back rather than
      // silently swallowing the lecturer's text and files.
      setInput(typedContent)
      setPendingAttachments(attachmentsForMessage)
      setReferencedAttachments(referencedForMessage)
      setQuotedReply(quotedReplyForMessage)
    }
  }

  /**
   * Discard an assistant response and ask the same question again.
   *
   * The user's message is left alone — only the answer is removed, server-side
   * as well as locally, so the retry survives a reload and the chat does not
   * collect abandoned responses. The original request is then replayed through
   * the normal send path so it picks up the same connectors and run wiring.
   */
  async function retryAssistantMessage(assistantMessage: ChatMessage) {
    if (!selectedBatch || !activeChat || sending || retryingMessageId) return

    const batchId = selectedBatch.id
    const chatId = activeChat.chat_id

    // The prompt is the nearest user message before this response.
    const index = messages.findIndex((item) => item.message_id === assistantMessage.message_id)
    if (index < 0) return
    let prompt = ''
    let userIndex = -1
    for (let i = index - 1; i >= 0; i -= 1) {
      if (messages[i].role === 'user') {
        prompt = String(messages[i].content || '').trim()
        userIndex = i
        break
      }
    }
    if (!prompt || userIndex < 0) return

    retryAbortedRef.current = false
    // Detach the run being replaced first. Its subscription and fallback poll
    // would otherwise keep writing into a conversation it no longer describes.
    if (assistantMessage.run_id) {
      unsubscribeFromRun(assistantMessage.run_id)
      stopFallbackTimers(assistantMessage.run_id)
    }

    setRetryingMessageId(assistantMessage.message_id)
    // Mark the composer busy from the first tap, not from when the run starts.
    // Deleting the old turn takes two round trips, and without this the composer
    // sits there showing Send with nothing to stop.
    setSending(true)

    // Re-sending necessarily writes a fresh user message (POST /messages creates
    // one), so the original turn is removed first — otherwise the prompt would
    // appear twice. The question stays on screen throughout because the resend
    // re-adds it immediately with the same text and attachments.
    const originalUser = messages[userIndex]
    const attachmentIds = (originalUser.attachments || [])
      .map((item) => item.attachment_id)
      .filter(Boolean)

    try {
      if (assistantMessage.message_id) {
        await deleteMessage(batchId, chatId, assistantMessage.message_id)
      }
      if (originalUser.message_id) {
        await deleteMessage(batchId, chatId, originalUser.message_id)
      }
    } catch {
      // Leave the turn intact if it could not be removed — re-running now would
      // leave two answers to the same question.
      setRetryingMessageId(null)
      setSending(false)
      return
    }

    setMessages((prev) =>
      prev.filter(
        (item) =>
          item.message_id !== assistantMessage.message_id &&
          item.message_id !== originalUser.message_id,
      ),
    )

    // Stopped while the old turn was being deleted. The deletes have already
    // landed, so the turn stays gone — but no new run is started.
    if (retryAbortedRef.current) {
      retryAbortedRef.current = false
      setRetryingMessageId(null)
      setSending(false)
      return
    }

    try {
      await startRunInChat({
        batchId,
        chat: activeChat,
        message: prompt,
        invoke: async () => sendMessage(batchId, chatId, prompt, connectors, attachmentIds),
        attachmentSnapshots: (originalUser.attachments || []) as PendingChatAttachment[],
      })
    } finally {
      setRetryingMessageId(null)
    }
  }

  /**
   * Stop the run that is currently streaming.
   *
   * The server polls the cancel flag between streamed chunks and closes the
   * Agent Engine stream, so the work genuinely stops; anything already streamed
   * is discarded. Here we just stop listening and settle the UI.
   */
  async function cancelActiveRun() {
    if (!selectedBatch || !activeChat || cancelling) return
    if (!currentRunId) {
      // A retry that has not reached its run yet: nothing to cancel server-side,
      // so record the intent and let retryAssistantMessage bail before starting.
      if (retryingMessageId) {
        retryAbortedRef.current = true
        setRetryingMessageId(null)
        setSending(false)
      }
      return
    }
    const runId = currentRunId
    setCancelling(true)
    try {
      await cancelChatRun(selectedBatch.id, activeChat.chat_id, runId)
    } catch {
      // Settle locally anyway: leaving the composer stuck in "sending" is worse
      // than a run that keeps going silently.
    } finally {
      settledRunIdsRef.current.add(runId)
      unsubscribeFromRun(runId)
      // Drop it from the cached chat too, so nothing downstream reads this run
      // as the chat's live one.
      setActiveChat((prev) =>
        prev && prev.active_run_id === runId ? { ...prev, active_run_id: undefined } : prev,
      )
      setRunStates((prev) => ({
        ...prev,
        [runId]: { ...(prev[runId] || {}), status: 'cancelled' } as RunUiState,
      }))
      // Keep the placeholder and settle it, rather than deleting it. Removing
      // the bubble left the turn looking like the request had simply vanished;
      // the lecturer needs to see that THEY stopped it. MessageRow reads the
      // run's 'cancelled' status to label it.
      setMessages((prev) =>
        prev.map((item) =>
          item.message_id === `pending-${runId}` || (item.pending && item.run_id === runId)
            ? {
                ...item,
                pending: false,
                status: 'done' as const,
                metadata: { ...(item.metadata || {}), run_cancelled: true },
              }
            : item,
        ),
      )
      setCurrentRunId(null)
      setSending(false)
      setCancelling(false)
    }
  }

  async function uploadAttachmentFiles(selectedFiles: File[]) {
    if (!selectedFiles.length || !selectedBatch || attachmentsUploading) return
    const errors: string[] = []
    const availableSlots = Math.max(0, 5 - pendingAttachments.length)
    const files = selectedFiles.slice(0, availableSlots)
    if (selectedFiles.length > availableSlots) errors.push('A message can include at most 5 attachments.')
    const existingImages = pendingAttachments.filter((item) => item.attachment_kind === 'image').length
    let acceptedImages = 0
    let totalBytes = pendingAttachments.reduce((sum, item) => sum + item.size_bytes, 0)
    const candidates = files.filter((file) => {
      const image = file.type.startsWith('image/') || /\.(png|jpe?g|webp|heic|heif)$/i.test(file.name)
      if (image && existingImages + acceptedImages >= 3) {
        errors.push(`${file.name}: A message can include at most 3 images.`)
        return false
      }
      if (totalBytes + file.size > 30 * 1024 * 1024) {
        errors.push(`${file.name}: Attachments exceed the 30 MB per-message limit.`)
        return false
      }
      if (image) acceptedImages += 1
      totalBytes += file.size
      return true
    })
    if (!candidates.length) {
      setAttachmentErrors(errors)
      return
    }
    let chat = activeChat
    if (!chat) chat = await handleNewChat('New Chat')
    if (!chat) return
    setAttachmentsUploading(true)
    setAttachmentErrors(errors)
    for (const file of candidates) {
      try {
        const attachment = await uploadChatAttachment(selectedBatch.id, chat.chat_id, file)
        const previewUrl = attachment.attachment_kind === 'image' ? URL.createObjectURL(file) : undefined
        setPendingAttachments((prev) => [...prev, { ...attachment, previewUrl }])
      } catch (err) {
        const detail = axios.isAxiosError(err) ? err.response?.data?.detail : ''
        errors.push(`${file.name}: ${typeof detail === 'string' ? detail : 'Upload failed.'}`)
      }
    }
    setAttachmentErrors([...errors])
    setAttachmentsUploading(false)
  }

  async function handleAttachmentFiles(e: ChangeEvent<HTMLInputElement>) {
    const selectedFiles = Array.from(e.target.files || [])
    e.target.value = ''
    await uploadAttachmentFiles(selectedFiles)
  }

  function handleComposerPaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    const imageFiles = Array.from(e.clipboardData.items)
      .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
      .map((item, index) => {
        const blob = item.getAsFile()
        if (!blob) return null
        const extension = {
          'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp',
          'image/heic': 'heic', 'image/heif': 'heif',
        }[blob.type]
        if (!extension) return null
        return new File(
          [blob],
          `screenshot-${new Date().toISOString().replace(/[:.]/g, '-')}-${index + 1}.${extension}`,
          { type: blob.type, lastModified: Date.now() },
        )
      })
      .filter((file): file is File => file !== null)
    if (!imageFiles.length) return
    e.preventDefault()
    void uploadAttachmentFiles(imageFiles)
  }

  function referencePreviousAttachment(item: ChatAttachmentListItem) {
    setAttachmentErrors([])
    setReferencedAttachments((prev) => {
      if (prev.some((a) => a.attachment_id === item.attachment_id)) return prev
      if (pendingAttachmentsRef.current.some((a) => a.attachment_id === item.attachment_id)) return prev
      return [...prev, item]
    })
  }

  function removeReferencedAttachment(attachmentId: string) {
    setReferencedAttachments((prev) => prev.filter((item) => item.attachment_id !== attachmentId))
  }

  async function removePendingAttachment(attachmentId: string) {
    const removed = pendingAttachments.find((item) => item.attachment_id === attachmentId)
    if (!removed) return
    // `pendingAttachments` only loses the item after the await below resolves,
    // so a second invocation during that round-trip would sail past the guard
    // above and fire a duplicate DELETE — the first returning 204 and the second
    // 404, which surfaced as "Attachment not found" on a removal that worked.
    if (removingAttachmentIdsRef.current.has(attachmentId)) return
    removingAttachmentIdsRef.current.add(attachmentId)
    try {
      await deleteChatAttachment(removed.batch_id, removed.chat_id, attachmentId)
    } catch (err) {
      // DELETE is idempotent: a 404 means it is already gone, which is exactly
      // the outcome we wanted. Fall through and drop it from the UI.
      const status = axios.isAxiosError(err) ? err.response?.status : undefined
      if (status !== 404) {
        const detail = axios.isAxiosError(err) ? err.response?.data?.detail : ''
        setAttachmentErrors([`${removed.file_name}: ${typeof detail === 'string' ? detail : 'Could not remove attachment; please retry.'}`])
        removingAttachmentIdsRef.current.delete(attachmentId)
        return
      }
    }
    if (removed.previewUrl) URL.revokeObjectURL(removed.previewUrl)
    setPendingAttachments((prev) => prev.filter((item) => item.attachment_id !== attachmentId))
    // Clear any earlier complaint about this same file so a stale message does
    // not outlive the attachment it referred to.
    setAttachmentErrors((prev) => prev.filter((msg) => !msg.startsWith(`${removed.file_name}:`)))
    removingAttachmentIdsRef.current.delete(attachmentId)
  }

  async function handleApproveOutline(message: ChatMessage) {
    if (!selectedBatch || !activeChat || sending || !message.run_id) return
    const metadata = message.metadata || {}
    const artifactType = String(metadata.outline_artifact_type || metadata.artifact_type || '')
    const mode: GenerateMode = artifactType === 'quiz' ? 'assessment' : artifactType as GenerateMode
    if (!['lesson_plan', 'lab', 'assessment', 'course_blueprint'].includes(mode)) return
    const label = mode === 'assessment' ? 'assessment' : mode.replace('_', ' ')
    const text = `Approve this outline and generate the full ${label} preview.`
    await startRunInChat({
      batchId: selectedBatch.id,
      chat: activeChat,
      message: text,
      invoke: async () => {
        const payload = {
          batch_id: selectedBatch.id,
          chat_id: activeChat.chat_id,
          workflow_type: `${mode}.generate`,
          workflow_stage: 'full' as const,
          approval_action: 'approve_outline' as const,
          approved_outline_run_id: message.run_id,
          week: typeof metadata.week === 'number' ? metadata.week : undefined,
          pending_artifact: true,
          save_draft: false,
          message: text,
          connectors,
        }
        const result = mode === 'course_blueprint'
          ? await invokeAgent(payload)
          : mode === 'lab'
          ? await generateLab('', payload)
          : mode === 'assessment'
            ? await generateAssessment('', payload)
            : await generateLessonPlan('', payload)
        return result as StartRunResult
      },
      workflowMode: mode,
    })
  }

  async function startRunInChat({
    batchId,
    chat,
    message,
    invoke,
    updateTitleIfNew = false,
    workflowMode = null,
    attachmentSnapshots = [],
  }: {
    batchId: string
    chat: Chat
    message: string
    invoke: () => Promise<StartRunResult>
    updateTitleIfNew?: boolean
    workflowMode?: GenerateMode | null
    attachmentSnapshots?: PendingChatAttachment[]
  }) {
    const chatId = chat.chat_id
    setSending(true)

    const optimisticUser: ChatMessage = {
      message_id: crypto.randomUUID(),
      chat_id: chatId,
      role: 'user',
      content: message,
      created_at: new Date().toISOString(),
      attachments: attachmentSnapshots,
    }
    setMessages((prev) => [...prev, optimisticUser])

    try {
      const result = await invoke()
      if (result.user_message) {
        setMessages((prev) => prev.map((item) => (
          item.message_id === optimisticUser.message_id ? result.user_message! : item
        )))
      }
      unsubscribeFromRun(result.run_id)
      if (workflowMode) {
        workflowModeRunIdsRef.current[result.run_id] = workflowMode
      }
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

      subscribeToRun(result.run_id, batchId, chatId, { withPolling: true })

      if (updateTitleIfNew && chat.title === 'New Chat') {
        const newTitle = titleFromMessage(message)
        void updateChatTitle(batchId, chatId, newTitle).then(() => {
          setChats((prev) =>
            prev.map((c) => (c.chat_id === chatId ? { ...c, title: newTitle } : c)),
          )
          setActiveChat((prev) => (prev ? { ...prev, title: newTitle } : prev))
        })
      }
      return true
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
      return false
    }
  }

  function updateRunStatus(runId: string, status: AgentRunStatus) {
    if (status === 'done' || status === 'failed' || status === 'cancelled') {
      settledRunIdsRef.current.add(runId)
    }
    setRunStates((prev) => {
      // A stop the lecturer asked for is final. A late 'failed' arriving from a
      // resubscribe must not relabel their deliberate stop as a crash.
      if (prev[runId]?.status === 'cancelled' && status !== 'cancelled') return prev
      return {
        ...prev,
        [runId]: {
          ...(prev[runId] || { events: [], steps: {} }),
          status,
        },
      }
    })
    anchorToBottomDuringLiveUpdate()
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
    anchorToBottomDuringLiveUpdate()
  }

  function appendRunDelta(
    runId: string,
    delta: AgentRunDelta,
    chatId: string,
    pendingId: string,
  ) {
    const indexes = runDeltaIndexesRef.current[runId] || new Set<number>()
    if (indexes.has(delta.index)) return
    indexes.add(delta.index)
    runDeltaIndexesRef.current[runId] = indexes

    setRunStates((prev) => {
      const current = prev[runId] || {
        status: 'running' as AgentRunStatus,
        events: [],
        steps: {},
      }
      return {
        ...prev,
        [runId]: {
          ...current,
          streamText: `${current.streamText || ''}${delta.delta}`,
          responseStarted: true,
          streamDeltaIndexes: {
            ...(current.streamDeltaIndexes || {}),
            [delta.index]: true,
          },
        },
      }
    })
    setMessages((prev) => {
      const hasFinal = prev.some(
        (msg) => msg.run_id === runId && msg.role === 'assistant' && !msg.pending,
      )
      if (hasFinal) return prev

      const pendingIndex = prev.findIndex(
        (msg) => msg.message_id === pendingId || (msg.pending && msg.run_id === runId),
      )

      if (pendingIndex >= 0) {
        return prev.map((msg) =>
          msg.message_id === pendingId || (msg.pending && msg.run_id === runId)
            ? {
                ...msg,
                content: `${msg.content || ''}${delta.delta}`,
                status: 'pending',
                pending: true,
              }
            : msg,
        )
      }

      return [
        ...prev,
        {
          message_id: pendingId,
          chat_id: chatId,
          role: 'assistant',
          content: delta.delta,
          created_at: new Date().toISOString(),
          status: 'pending',
          run_id: runId,
          pending: true,
        },
      ]
    })
    anchorToBottomDuringLiveUpdate()
  }

  function updateRunStreamMeta(runId: string, meta: AgentRunStreamMeta) {
    setRunStates((prev) => {
      const current = prev[runId] || {
        status: 'running' as AgentRunStatus,
        events: [],
        steps: {},
      }
      return {
        ...prev,
        [runId]: {
          ...current,
          streamDone: meta.done ?? current.streamDone,
          responseStarted:
            current.responseStarted ||
            meta.response_started === true ||
            (meta.chunk_count || 0) > 0,
        },
      }
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
    anchorToBottomDuringLiveUpdate()
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

  function maybeClearGenerateModeFromFinalMessage(message: Pick<ChatMessage, 'run_id' | 'metadata'>) {
    const runId = message.run_id
    if (!runId || !workflowModeRunIdsRef.current[runId]) return
    if (
      message.metadata?.pending_exportable === true ||
      message.metadata?.pending_savable_blueprint === true ||
      message.metadata?.pending_savable_game === true ||
      message.metadata?.pending_email_sendable === true
    ) {
      setActiveGenerateMode(null)
      delete workflowModeRunIdsRef.current[runId]
    }
  }

  function upsertLiveAssistantMessage(
    message: Omit<ChatMessage, 'chat_id'>,
    pendingId: string,
    chatId: string,
  ) {
    maybeClearGenerateModeFromFinalMessage(message)
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
    anchorToBottomDuringLiveUpdate()
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

  /**
   * One tick of the fallback. Asks the run document whether it has settled — a
   * single field — and only pays for the whole message list once it has.
   * Fetching every message on every tick made one stalled run cost hundreds of
   * document reads. Returns true when the run is finished.
   */
  async function pollRunSettledOnce(
    batchId: string,
    chatId: string,
    runId: string,
    pendingId: string,
  ): Promise<boolean> {
    const record = await getChatRun(batchId, chatId, runId)
    if (record.status !== 'done' && record.status !== 'failed' && record.status !== 'cancelled') {
      return false
    }
    await pollFinalMessagesOnce(batchId, chatId, runId, pendingId)
    return true
  }

  /** Record a live-channel signal and push the stall deadline back. */
  function armStallWatchdog(
    batchId: string,
    chatId: string,
    runId: string,
    pendingId: string,
  ) {
    stallWatchdogRef.current.alive(runId, {
      onStall: () => {
        updateRunStreamError(runId, STREAM_DELAY_MESSAGE)
        startFallbackPolling(batchId, chatId, runId, pendingId)
      },
      onRecover: () => {
        // The stream came back — stop paying for polls and drop the warning.
        stopFallbackPolling(runId)
        updateRunStreamError(runId, '')
      },
    })
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
      void pollRunSettledOnce(batchId, chatId, runId, pendingId)
        .then((settled) => {
          if (settled || Date.now() - startedAt > 5 * 60_000) {
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
    stallWatchdogRef.current.clear(runId)
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
      const settled = fetched.map((msg) =>
        msg.run_id
          ? { ...msg, status: msg.role === 'assistant' ? 'done' : msg.status, pending: false }
          : msg,
      )
      // A poll for THIS run must not wipe a message the server cannot know about.
      return [...settled, ...localOnlyMessages(previous, fetched)]
    }

    const latestAssistant = fetchedAssistant.at(-1)
    if (latestAssistant) {
      maybeClearGenerateModeFromFinalMessage({
        ...latestAssistant,
        run_id: latestAssistant.run_id || runId,
      })
    }
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
    const attachmentIds = pendingInitialAttachmentIdsRef.current
    pendingInitialMessageRef.current = null
    pendingInitialAttachmentIdsRef.current = []
    // Passed explicitly rather than pushed through `pendingAttachments` state:
    // these were uploaded on the previous page, and a setState here would not
    // be visible to handleSend until the next render.
    void handleSend(message, attachmentIds.length ? { attachmentIds } : undefined)
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

  function cancelRename() {
    setRenamingId(null)
    setRenameValue('')
  }

  async function commitRename() {
    if (!renamingId || !selectedBatch) return
    const chatId = renamingId
    const title = renameValue.trim()
    if (!title) {
      cancelRename()
      return
    }
    try {
      await updateChatTitle(selectedBatch.id, chatId, title)
    } catch (err) {
      console.error(err)
      return
    }
    setChats((prev) => prev.map((c) => (c.chat_id === chatId ? { ...c, title } : c)))
    if (activeChat?.chat_id === chatId) {
      setActiveChat((prev) => (prev ? { ...prev, title } : prev))
    }
    cancelRename()
  }

  async function handleDeleteChat(chat: Chat) {
    if (!selectedBatch) return
    const isActiveChat = activeChat?.chat_id === chat.chat_id
    const runIds = new Set<string>()
    if (chat.active_run_id) runIds.add(chat.active_run_id)
    if (chat.last_run_id) runIds.add(chat.last_run_id)
    if (isActiveChat) {
      collectRunIds(messages, activeChat).forEach((runId) => runIds.add(runId))
    }

    try {
      await deleteChat(selectedBatch.id, chat.chat_id)
    } catch (err) {
      console.error(err)
      return
    }

    runIds.forEach((runId) => unsubscribeFromRun(runId))
    setRunStates((prev) => {
      const next = { ...prev }
      runIds.forEach((runId) => {
        delete next[runId]
      })
      return next
    })
    setChats((prev) => prev.filter((c) => c.chat_id !== chat.chat_id))
    if (isActiveChat) {
      setActiveChat(null)
      setMessages([])
      setCurrentRunId(null)
      setSending(false)
      navigate('/chat')
    }
    cancelRename()
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
      if (!batch) {
        navigate('/chat')
        setSelectedBatch(null)
        return
      }
      setSelectedBatch(batch)
      if (routeBatchId && routeChatId) {
        navigate('/chat')
      }
    },
    chats,
    chatsLoading,
    renamingId,
    setRenamingId,
    renameValue,
    setRenameValue,
    activeChat,
    selectChat,
    messages,
    messagesLoading,
    input,
    setInput,
    activeGenerateMode,
    setActiveGenerateMode,
    sending,
    pendingAttachments,
    referencedAttachments,
    quotedReply,
    setQuotedReply,
    attachmentsUploading,
    attachmentErrors,
    handleAttachmentFiles,
    removePendingAttachment,
    referencePreviousAttachment,
    removeReferencedAttachment,
    handleComposerPaste,
    currentRunId,
    runStates,
    inputDisabled,
    messagesEndRef,
    textareaRef,
    renameInputRef,
    handleNewChat,
    handleSend,
    cancelActiveRun,
    cancelling,
    retryAssistantMessage,
    retryingMessageId,
    handleApproveOutline,
    handleInputKeyDown,
    handleTextareaInput,
    startRename,
    commitRename,
    cancelRename,
    handleDeleteChat,
    showWelcome,
    connectors,
    setConnectors: updateConnectors,
    routeHydration,
  }
}

export type ChatPageState = ReturnType<typeof useChatPage>
