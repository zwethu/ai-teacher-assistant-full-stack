import { useCallback, useEffect, useRef, useState } from 'react'
import axios from 'axios'
import type { Batch } from '../entity/Batch'
import type { Chat, ChatAttachment, ChatMessage } from '../entity/Chat'
import {
  cancelChatRun,
  createChat,
  deleteChatAttachment,
  getChatAttachmentRagStatus,
  getChatRun,
  listMessages,
  sendMessage,
  uploadChatAttachment,
} from '../services/chatService'
import { invokeAgent } from '../services/agentService'
import { clearGenerationRun, readGenerationRun, writeGenerationRun } from './generationRunStore'
import { createStallWatchdog } from './streamStallWatchdog'
import {
  subscribeChatAttachments,
  type ChatAttachmentStatusEvent,
} from '../services/chatAttachmentStream'
import {
  subscribeAgentRun,
  type AgentRunDelta,
  type AgentRunEvent,
  type AgentRunStatus,
  type AgentRunStep,
  type AgentRunStreamMeta,
} from '../services/agentRunStream'
import type { RunUiState } from '../pages/chat/runTypes'

/**
 * Single-run generation orchestrator for standalone surfaces (Lesson Plan,
 * Assessment, Plan). Mirrors the chat run lifecycle — one auto-created "workflow
 * chat" per surface, outline→approve→full HITL, live streaming via subscribeAgentRun,
 * retry-with-edits as a follow-up message — but scoped to a single active run rather
 * than a full chat history. Terminal export/persist is handled by MessageRow's own
 * ArtifactExportButton (chat is untouched; this reuses the same primitives).
 */

export type PendingChatAttachment = ChatAttachment & { previewUrl?: string }

export type GenerationWorkflow =
  | 'lesson_plan'
  | 'assessment'
  | 'lab'
  | 'course_blueprint'
  | 'game'

// Game is single-shot: no research/outline/approval. It must send an empty
// workflow_stage or the backend's outline branch fires, finds no game outline, and the
// run ends in outline_extract.failed instead of staging a game.
const SINGLE_SHOT_WORKFLOWS = new Set<GenerationWorkflow>(['game'])

export type GenerateParams = {
  workflowType: GenerationWorkflow
  message: string
  week?: number
  webSearch?: boolean
}

type InvokeResult = {
  run_id: string
  chat_id?: string
  rtdb_run_path?: string
  status?: AgentRunStatus
  user_message?: ChatMessage
}

const STREAM_DELAY_MESSAGE =
  'Live updates are delayed. I will fetch the final response when ready.'

/** Backstop cadence for attachment readiness; RTDB carries the fast path. */
const ATTACHMENT_FALLBACK_POLL_MS = 10_000

function invokeErrorMessage(err: unknown): string {
  if (!axios.isAxiosError(err)) return 'Sorry, something went wrong. Please try again.'
  const detail = err.response?.data?.detail
  const message = typeof detail?.message === 'string' ? detail.message : ''
  return message || (typeof detail === 'string' ? detail : '') || 'Sorry, something went wrong. Please try again.'
}

export function useGenerationRun(batch: Batch | null, persistKey?: string) {
  const [chat, setChat] = useState<Chat | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [runStates, setRunStates] = useState<Record<string, RunUiState>>({})
  const [currentRunId, setCurrentRunId] = useState<string | null>(null)
  // Which HITL phase the in-flight run belongs to. Lets the workflow renderer
  // tell "drafting outline" from "generating full preview" during the pending
  // window (before the resolved message carries stage metadata).
  const [activePhase, setActivePhase] = useState<'outline' | 'full' | 'refine' | null>(null)
  const [sending, setSending] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [pendingAttachments, setPendingAttachments] = useState<PendingChatAttachment[]>([])
  const [attachmentsUploading, setAttachmentsUploading] = useState(false)
  const [attachmentErrors, setAttachmentErrors] = useState<string[]>([])

  const runUnsubscribesRef = useRef<Record<string, () => void>>({})
  const runDeltaIndexesRef = useRef<Record<string, Set<number>>>({})
  // Per-run silence detector for the live RTDB channel; see streamStallWatchdog.
  const stallWatchdogRef = useRef(createStallWatchdog())
  // Mirror of the RTDB connection flag, readable inside the stall callback.
  // `.info/connected` fires promptly on subscribe, so by the time the watchdog
  // trips, `true` here means the channel is healthy and the run is just quiet
  // (schema-bound generation writes nothing for a minute or more) — poll
  // silently. Anything else means the channel itself is in doubt — say so.
  const runLiveConnectedRef = useRef<Record<string, boolean>>({})
  const pollIntervalRef = useRef<Record<string, number>>({})
  const chatRef = useRef<Chat | null>(null)
  useEffect(() => { chatRef.current = chat }, [chat])

  // Persistence: a run continues server-side even after the page unmounts, so we
  // keep the chat + run id in a module store keyed by (batch, surface) and reconnect
  // on return. persistIdRef/subscribeToRunRef are set during render so the effect
  // below (which runs before later effects) can read them on first mount.
  const batchId = batch?.id ?? null
  const persistId = persistKey && batchId ? `${batchId}:${persistKey}` : null
  const persistIdRef = useRef<string | null>(null)
  persistIdRef.current = persistId
  const subscribeToRunRef = useRef<((runId: string, chatId: string) => void) | null>(null)

  // On batch/key change (incl. mount): tear down live subs, then rehydrate the
  // persisted run for this key — or reset to an empty workspace if there is none.
  useEffect(() => {
    Object.values(runUnsubscribesRef.current).forEach((fn) => fn())
    runUnsubscribesRef.current = {}
    Object.values(pollIntervalRef.current).forEach((t) => window.clearInterval(t))
    pollIntervalRef.current = {}
    stallWatchdogRef.current.clear()
    runDeltaIndexesRef.current = {}
    setPendingAttachments([])
    setAttachmentErrors([])

    const persisted = persistId ? readGenerationRun(persistId) : undefined
    if (persisted?.chat) {
      const persistedChat = persisted.chat
      const runId = persisted.currentRunId
      chatRef.current = persistedChat
      setChat(persistedChat)
      setRunStates({})
      setCurrentRunId(runId)
      setActivePhase(persisted.activePhase)
      listMessages(persistedChat.batch_id, persistedChat.chat_id)
        .then((loaded) => {
          setMessages(() => {
            const base: ChatMessage[] = loaded.map((m) => ({ ...m, pending: false }))
            if (runId && !base.some((m) => m.run_id === runId && m.role === 'assistant')) {
              base.push({
                message_id: `pending-${runId}`, chat_id: persistedChat.chat_id, role: 'assistant',
                content: '', created_at: new Date().toISOString(), status: 'pending', run_id: runId, pending: true,
              })
            }
            return base
          })
        })
        .catch(() => {})
      if (runId) {
        setSending(true)
        subscribeToRunRef.current?.(runId, persistedChat.chat_id)
      } else {
        setSending(false)
      }
      return
    }

    chatRef.current = null
    setChat(null)
    setMessages([])
    setRunStates({})
    setCurrentRunId(null)
    setActivePhase(null)
    setSending(false)
  }, [batchId, persistId])

  // Poll processing attachments so the composer reflects readiness.
  useEffect(() => {
    const activeChatId = chat?.chat_id
    const transitional = pendingAttachments.filter((a) => a.status === 'processing')
    if (!batchId || !activeChatId || transitional.length === 0) return
    let cancelled = false
    const apply = (update: ChatAttachmentStatusEvent) => {
      if (cancelled) return
      setPendingAttachments((current) =>
        current.map((item) =>
          item.attachment_id === update.attachment_id ? { ...item, ...update } : item))
    }

    // Push: the backend mirrors every transition, and onChildAdded replays the
    // current state, so readiness normally arrives without a request.
    const unsubscribe = subscribeChatAttachments(activeChatId, { onStatus: apply })

    // Pull: backstop for RTDB being unconfigured or unreachable, nothing more.
    const refresh = async () => {
      const updates = await Promise.all(
        transitional.map(async (item) => {
          try { return await getChatAttachmentRagStatus(batchId, activeChatId, item.attachment_id) }
          catch { return null }
        }),
      )
      if (cancelled) return
      updates.forEach((update) => { if (update) apply(update) })
    }
    const timer = window.setInterval(() => void refresh(), ATTACHMENT_FALLBACK_POLL_MS)
    return () => { cancelled = true; unsubscribe(); window.clearInterval(timer) }
  }, [batchId, chat?.chat_id, pendingAttachments.map((a) => `${a.attachment_id}:${a.status}`).join('|')])

  useEffect(() => () => {
    Object.values(runUnsubscribesRef.current).forEach((fn) => fn())
    Object.values(pollIntervalRef.current).forEach((t) => window.clearInterval(t))
    stallWatchdogRef.current.clear()
    pendingAttachments.forEach((a) => a.previewUrl && URL.revokeObjectURL(a.previewUrl))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const ensureChat = useCallback(async (): Promise<Chat | null> => {
    if (chatRef.current) return chatRef.current
    if (!batch) return null
    // Reuse a persisted workflow chat for this surface if one exists (survives nav).
    const persisted = persistIdRef.current ? readGenerationRun(persistIdRef.current) : undefined
    if (persisted?.chat) {
      chatRef.current = persisted.chat
      setChat(persisted.chat)
      return persisted.chat
    }
    // Hidden "workflow" chat: a run container for standalone generation, never
    // shown in Chat History (backend list_chats filters hidden/workflow chats).
    const created = await createChat(batch.id, 'Generation workspace', {
      type: 'workflow',
      workflowType: 'generation',
      hidden: true,
    })
    chatRef.current = created
    setChat(created)
    if (persistIdRef.current) writeGenerationRun(persistIdRef.current, { chat: created })
    return created
  }, [batch])

  // ---- run-state reducers (ported from useChatPage, single-run scoped) ----

  const ensureRunState = useCallback((runId: string, status: AgentRunStatus = 'running') => {
    setRunStates((prev) => ({
      ...prev,
      [runId]: prev[runId] || { status, events: [], steps: {}, liveConnected: true },
    }))
  }, [])

  const updateRunStatus = useCallback((runId: string, status: AgentRunStatus) => {
    setRunStates((prev) => ({
      ...prev,
      [runId]: { ...(prev[runId] || { events: [], steps: {} }), status },
    }))
  }, [])

  const appendRunEvent = useCallback((runId: string, event: AgentRunEvent) => {
    setRunStates((prev) => {
      const current = prev[runId] || { status: 'running' as AgentRunStatus, events: [], steps: {} }
      // Stable sort on the timestamp alone — `created_at` is whole seconds and
      // `event_id` is a random uuid, so tie-breaking on the id shuffles
      // everything inside one second. See the same note in useChatPage.
      const events = current.events.some((e) => e.event_id === event.event_id)
        ? current.events
        : [...current.events, event].sort((a, b) => (a.created_at || 0) - (b.created_at || 0))
      return { ...prev, [runId]: { ...current, events } }
    })
  }, [])

  const upsertRunStep = useCallback((runId: string, step: AgentRunStep) => {
    setRunStates((prev) => {
      const current = prev[runId] || { status: 'running' as AgentRunStatus, events: [], steps: {} }
      return { ...prev, [runId]: { ...current, steps: { ...current.steps, [step.step_id]: step } } }
    })
  }, [])

  const updateRunStreamMeta = useCallback((runId: string, meta: AgentRunStreamMeta) => {
    setRunStates((prev) => {
      const current = prev[runId] || { status: 'running' as AgentRunStatus, events: [], steps: {} }
      return {
        ...prev,
        [runId]: {
          ...current,
          streamDone: meta.done ?? current.streamDone,
          responseStarted:
            current.responseStarted || meta.response_started === true || (meta.chunk_count || 0) > 0,
        },
      }
    })
  }, [])

  const updateRunStreamError = useCallback((runId: string, streamError: string) => {
    setRunStates((prev) => {
      const current = prev[runId] || { status: 'running' as AgentRunStatus, events: [], steps: {} }
      return { ...prev, [runId]: { ...current, streamError } }
    })
  }, [])

  const updateRunError = useCallback((runId: string, runError: string) => {
    setRunStates((prev) => {
      const current = prev[runId] || { status: 'running' as AgentRunStatus, events: [], steps: {} }
      return { ...prev, [runId]: { ...current, runError } }
    })
  }, [])

  const updateRunConnection = useCallback((runId: string, liveConnected: boolean) => {
    runLiveConnectedRef.current[runId] = liveConnected
    setRunStates((prev) => {
      const current = prev[runId] || { status: 'running' as AgentRunStatus, events: [], steps: {} }
      return { ...prev, [runId]: { ...current, liveConnected } }
    })
  }, [])

  const appendRunDelta = useCallback(
    (runId: string, delta: AgentRunDelta, chatId: string, pendingId: string) => {
      const indexes = runDeltaIndexesRef.current[runId] || new Set<number>()
      if (indexes.has(delta.index)) return
      indexes.add(delta.index)
      runDeltaIndexesRef.current[runId] = indexes

      setRunStates((prev) => {
        const current = prev[runId] || { status: 'running' as AgentRunStatus, events: [], steps: {} }
        return {
          ...prev,
          [runId]: {
            ...current,
            streamText: `${current.streamText || ''}${delta.delta}`,
            responseStarted: true,
            streamDeltaIndexes: { ...(current.streamDeltaIndexes || {}), [delta.index]: true },
          },
        }
      })
      setMessages((prev) => {
        if (prev.some((m) => m.run_id === runId && m.role === 'assistant' && !m.pending)) return prev
        const idx = prev.findIndex((m) => m.message_id === pendingId || (m.pending && m.run_id === runId))
        if (idx >= 0) {
          return prev.map((m) =>
            m.message_id === pendingId || (m.pending && m.run_id === runId)
              ? { ...m, content: `${m.content || ''}${delta.delta}`, status: 'pending', pending: true }
              : m,
          )
        }
        return [
          ...prev,
          {
            message_id: pendingId, chat_id: chatId, role: 'assistant', content: delta.delta,
            created_at: new Date().toISOString(), status: 'pending', run_id: runId, pending: true,
          },
        ]
      })
    },
    [],
  )

  const stopTimers = useCallback((runId: string) => {
    stallWatchdogRef.current.clear(runId)
    if (pollIntervalRef.current[runId]) {
      window.clearInterval(pollIntervalRef.current[runId])
      delete pollIntervalRef.current[runId]
    }
  }, [])

  const upsertFinalMessage = useCallback(
    (message: Omit<ChatMessage, 'chat_id'>, pendingId: string, chatId: string) => {
      setMessages((prev) => {
        const finalMessage: ChatMessage = {
          ...message, chat_id: chatId, status: 'done', pending: false, run_id: message.run_id,
        }
        const existingIndex = prev.findIndex((m) => m?.message_id === finalMessage.message_id)
        if (existingIndex >= 0) return prev.map((m, i) => (i === existingIndex ? finalMessage : m))
        return prev
          .filter(Boolean)
          .map((m) =>
            m.message_id === pendingId || (m.pending && m.run_id === message.run_id) ? finalMessage : m,
          )
      })
    },
    [],
  )

  const pollFinalOnce = useCallback(async (chatId: string, runId: string, pendingId: string) => {
    if (!batchId) return
    const data = await listMessages(batchId, chatId)
    setMessages((prev) => {
      const hasFinal = data.some((m) => m.run_id === runId && m.role === 'assistant')
      if (!hasFinal) return prev
      const withoutPending = prev.filter((m) => m.message_id !== pendingId)
      const merged = [...withoutPending]
      data.forEach((m) => {
        if (!merged.some((x) => x.message_id === m.message_id)) {
          merged.push({ ...m, status: m.role === 'assistant' ? 'done' : m.status, pending: false })
        }
      })
      return merged
    })
    setSending(false)
  }, [batchId])

  /**
   * One tick of the fallback: read the run document's status rather than the whole
   * conversation, and only fetch messages once it has actually settled. Returns
   * true when the run is finished.
   */
  const pollRunSettledOnce = useCallback(
    async (chatId: string, runId: string, pendingId: string): Promise<boolean> => {
      if (!batchId) return false
      const record = await getChatRun(batchId, chatId, runId)
      if (record.status !== 'done' && record.status !== 'failed' && record.status !== 'cancelled') {
        return false
      }
      await pollFinalOnce(chatId, runId, pendingId)
      return true
    },
    [batchId, pollFinalOnce],
  )

  const startPolling = useCallback(
    (chatId: string, runId: string, pendingId: string) => {
      if (pollIntervalRef.current[runId]) return
      pollIntervalRef.current[runId] = window.setInterval(() => {
        void pollRunSettledOnce(chatId, runId, pendingId)
          .then((settled) => { if (settled) stopTimers(runId) })
          .catch(console.error)
      }, 5000)
    },
    [pollRunSettledOnce, stopTimers],
  )

  /** Record a live-channel signal and push the stall deadline back. */
  const armStallWatchdog = useCallback(
    (chatId: string, runId: string, pendingId: string) => {
      stallWatchdogRef.current.alive(runId, {
        onStall: () => {
          // Quiet ≠ broken: only warn when the RTDB channel itself is down.
          // The polling backstop engages either way.
          if (runLiveConnectedRef.current[runId] !== true) {
            updateRunStreamError(runId, STREAM_DELAY_MESSAGE)
          }
          startPolling(chatId, runId, pendingId)
        },
        onRecover: () => {
          if (pollIntervalRef.current[runId]) {
            window.clearInterval(pollIntervalRef.current[runId])
            delete pollIntervalRef.current[runId]
          }
          updateRunStreamError(runId, '')
        },
      })
    },
    [startPolling, updateRunStreamError],
  )

  const subscribeToRun = useCallback(
    (runId: string, chatId: string) => {
      if (runUnsubscribesRef.current[runId]) return
      const pendingId = `pending-${runId}`
      ensureRunState(runId)
      const alive = () => armStallWatchdog(chatId, runId, pendingId)
      runUnsubscribesRef.current[runId] = subscribeAgentRun(runId, {
        onMessage: (m) => { upsertFinalMessage(m, pendingId, chatId); setSending(false); stopTimers(runId) },
        onStatus: (status) => {
          updateRunStatus(runId, status)
          if (status === 'running' || status === 'awaiting_attachments') alive()
          if (status === 'done' || status === 'failed') {
            setActivePhase(null)
            if (persistIdRef.current) writeGenerationRun(persistIdRef.current, { activePhase: null })
          }
          if (status === 'done') { stopTimers(runId); void pollFinalOnce(chatId, runId, pendingId) }
          if (status === 'failed') {
            stopTimers(runId)
            setMessages((prev) => prev.map((m) =>
              m.pending && m.run_id === runId ? { ...m, status: 'failed', pending: false } : m))
            setSending(false)
          }
          if (status === 'cancelled') {
            // Arrives on reload or in a second tab; the tab that pressed Stop has
            // already torn its subscription down. Settle so nothing hangs.
            stopTimers(runId)
            setSending(false)
          }
        },
        onEvent: (e) => { alive(); appendRunEvent(runId, e) },
        onStep: (s) => { alive(); upsertRunStep(runId, s) },
        onDelta: (d) => { alive(); appendRunDelta(runId, d, chatId, pendingId) },
        onStreamMeta: (meta) => updateRunStreamMeta(runId, meta),
        onRunError: (msg) => updateRunError(runId, msg),
        onDisconnected: (connected) => updateRunConnection(runId, connected),
        onError: (err) => {
          console.error(err)
          updateRunStreamError(runId, STREAM_DELAY_MESSAGE)
          startPolling(chatId, runId, pendingId)
        },
      })
      alive()
    },
    [ensureRunState, upsertFinalMessage, stopTimers, updateRunStatus, appendRunEvent, upsertRunStep,
     appendRunDelta, updateRunStreamMeta, updateRunError, updateRunConnection, updateRunStreamError,
     pollFinalOnce, armStallWatchdog, startPolling],
  )
  // Expose the latest subscribeToRun to the rehydrate effect (set during render so
  // it is available before effects run on first mount).
  subscribeToRunRef.current = subscribeToRun

  const startRun = useCallback(
    async (chatId: string, message: string, invoke: () => Promise<InvokeResult>, attachmentSnapshots: PendingChatAttachment[] = []) => {
      setSending(true)
      const optimisticUser: ChatMessage = {
        message_id: crypto.randomUUID(), chat_id: chatId, role: 'user', content: message,
        created_at: new Date().toISOString(), attachments: attachmentSnapshots,
      }
      setMessages((prev) => [...prev, optimisticUser])
      try {
        const result = await invoke()
        if (result.user_message) {
          setMessages((prev) => prev.map((m) => (m.message_id === optimisticUser.message_id ? result.user_message! : m)))
        }
        const pendingId = `pending-${result.run_id}`
        setCurrentRunId(result.run_id)
        if (persistIdRef.current) {
          writeGenerationRun(persistIdRef.current, { chat: chatRef.current, currentRunId: result.run_id })
        }
        ensureRunState(result.run_id, (result.status as AgentRunStatus) || 'running')
        setMessages((prev) => [
          ...prev.filter(Boolean),
          {
            message_id: pendingId, chat_id: chatId, role: 'assistant', content: '',
            created_at: new Date().toISOString(), status: 'pending', run_id: result.run_id, pending: true,
          },
        ])
        subscribeToRun(result.run_id, chatId)
        return true
      } catch (err) {
        console.error(err)
        setMessages((prev) => [
          ...prev,
          {
            message_id: crypto.randomUUID(), chat_id: chatId, role: 'assistant',
            content: invokeErrorMessage(err), created_at: new Date().toISOString(),
          },
        ])
        setSending(false)
        return false
      }
    },
    [ensureRunState, subscribeToRun],
  )

  // ---- public actions ----

  const generate = useCallback(
    async ({ workflowType, message, week, webSearch = true }: GenerateParams) => {
      if (!batch || sending) return
      const activeChat = await ensureChat()
      if (!activeChat) return
      const singleShot = SINGLE_SHOT_WORKFLOWS.has(workflowType)
      const phase = singleShot ? 'full' : 'outline'
      setActivePhase(phase)
      if (persistIdRef.current) writeGenerationRun(persistIdRef.current, { activePhase: phase })
      const attachmentsForMessage = [...pendingAttachments]
      const attachmentIds = attachmentsForMessage.map((a) => a.attachment_id)
      const started = await startRun(
        activeChat.chat_id,
        message,
        async () => {
          const data = await invokeAgent({
            batch_id: batch.id,
            chat_id: activeChat.chat_id,
            workflow_type: `${workflowType}.generate`,
            workflow_stage: singleShot ? '' : 'outline',
            pending_artifact: true,
            save_draft: false,
            week,
            message,
            connectors: { web_search: webSearch },
            attachment_ids: attachmentIds,
          })
          return data as InvokeResult
        },
        attachmentsForMessage,
      )
      if (started) {
        attachmentsForMessage.forEach((a) => a.previewUrl && URL.revokeObjectURL(a.previewUrl))
        setPendingAttachments([])
        setAttachmentErrors([])
      }
    },
    [batch, sending, ensureChat, pendingAttachments, startRun],
  )

  const approveOutline = useCallback(
    async (message: ChatMessage) => {
      if (!batch || sending || !message.run_id || !chatRef.current) return
      const metadata = message.metadata || {}
      const artifactType = String(metadata.outline_artifact_type || metadata.artifact_type || '')
      const mode: GenerationWorkflow =
        artifactType === 'quiz' ? 'assessment' : (artifactType as GenerationWorkflow)
      if (!['lesson_plan', 'lab', 'assessment', 'course_blueprint'].includes(mode)) return
      setActivePhase('full')
      if (persistIdRef.current) writeGenerationRun(persistIdRef.current, { activePhase: 'full' })
      const chatId = chatRef.current.chat_id
      const text = 'Approve this outline and generate the full preview.'
      await startRun(chatId, text, async () => {
        const data = await invokeAgent({
          batch_id: batch.id,
          chat_id: chatId,
          workflow_type: `${mode}.generate`,
          workflow_stage: 'full',
          approval_action: 'approve_outline',
          approved_outline_run_id: message.run_id,
          week: typeof metadata.week === 'number' ? metadata.week : undefined,
          pending_artifact: true,
          save_draft: false,
          message: text,
          connectors: { web_search: true },
        })
        return data as InvokeResult
      })
    },
    [batch, sending, startRun],
  )

  const sendFollowUp = useCallback(
    async (text: string, refineOf: ChatMessage | null = null, webSearch = true) => {
      const content = text.trim()
      if (!batch || !content || sending || !chatRef.current) return
      const chatId = chatRef.current.chat_id

      // Outline revision: keep the workflow context so the backend re-seeds the
      // current outline (CURRENT OUTLINE block) and the revised outline comes back
      // as a NEW approvable card. A plain /messages follow-up would supersede the
      // outline with no way to ever re-approve.
      const refineMeta = refineOf?.metadata || {}
      const refineArtifact = String(
        refineMeta.outline_artifact_type || refineMeta.artifact_type || '',
      )
      const refineMode: GenerationWorkflow | '' =
        refineArtifact === 'quiz' ? 'assessment' : (refineArtifact as GenerationWorkflow)
      const refineModeKnown =
        ['lesson_plan', 'lab', 'assessment', 'course_blueprint'].includes(refineMode)
      // A full preview card refines the generated artifact (refine_full); an
      // outline card refines the outline. Both must stay gated workflow invokes:
      // a plain follow-up would be refused by the agent's generation gate, and
      // even before that gate existed it produced text-only revisions while the
      // card and its Export silently kept the old content.
      const isFullPreviewCard = refineMeta.artifact_preview_card === true
      const approvedOutlineRunId = String(refineMeta.approved_outline_run_id || '')
      const canRefineFull =
        Boolean(refineOf?.run_id) && refineModeKnown && isFullPreviewCard &&
        Boolean(approvedOutlineRunId)
      const canRefineOutline =
        Boolean(refineOf?.run_id) && refineModeKnown && !isFullPreviewCard

      const nextPhase = canRefineFull ? 'full' : canRefineOutline ? 'outline' : 'refine'
      setActivePhase(nextPhase)
      if (persistIdRef.current) {
        writeGenerationRun(persistIdRef.current, { activePhase: nextPhase })
      }
      await startRun(chatId, content, async () => {
        if (canRefineFull && refineOf) {
          const week =
            typeof refineMeta.pending_artifact_week === 'number'
              ? refineMeta.pending_artifact_week
              : typeof refineMeta.week === 'number'
                ? refineMeta.week
                : undefined
          const data = await invokeAgent({
            batch_id: batch.id,
            chat_id: chatId,
            workflow_type: `${refineMode}.generate`,
            workflow_stage: 'full',
            approval_action: 'refine_full',
            approved_outline_run_id: approvedOutlineRunId,
            week,
            pending_artifact: true,
            save_draft: false,
            message: content,
            connectors: { web_search: webSearch },
          })
          return data as InvokeResult
        }
        if (canRefineOutline && refineOf) {
          const data = await invokeAgent({
            batch_id: batch.id,
            chat_id: chatId,
            workflow_type: `${refineMode}.generate`,
            workflow_stage: 'outline',
            approval_action: 'refine_outline',
            approved_outline_run_id: refineOf.run_id,
            week: typeof refineMeta.week === 'number' ? refineMeta.week : undefined,
            pending_artifact: false,
            save_draft: false,
            message: content,
            connectors: { web_search: webSearch },
          })
          return data as InvokeResult
        }
        const data = await sendMessage(batch.id, chatId, content, { web_search: webSearch }, [])
        return data as InvokeResult
      })
    },
    [batch, sending, startRun],
  )

  /**
   * Stop the in-flight generation. The backend polls the cancel flag between
   * streamed chunks and tears the Agent Engine stream down, so this genuinely
   * ends the work rather than just muting the UI. We keep the placeholder
   * message so the stage renderer has something to hang "cancelled" off, and
   * drop the persisted run id so returning to the page does not resubscribe.
   */
  const cancelRun = useCallback(async () => {
    const activeChat = chatRef.current
    if (!batch || !activeChat || !currentRunId || cancelling) return
    const runId = currentRunId
    setCancelling(true)
    try {
      await cancelChatRun(batch.id, activeChat.chat_id, runId)
    } catch {
      // Settle locally regardless — a stuck "generating" panel is worse than a
      // run that quietly keeps going.
    } finally {
      runUnsubscribesRef.current[runId]?.()
      delete runUnsubscribesRef.current[runId]
      stopTimers(runId)
      setRunStates((prev) => ({
        ...prev,
        [runId]: {
          ...(prev[runId] || { events: [], steps: {} }),
          status: 'cancelled',
        } as RunUiState,
      }))
      setMessages((prev) =>
        prev.map((m) =>
          m.pending && m.run_id === runId ? { ...m, pending: false, status: 'done' } : m,
        ),
      )
      setActivePhase(null)
      setSending(false)
      setCancelling(false)
      if (persistIdRef.current) {
        writeGenerationRun(persistIdRef.current, { currentRunId: null, activePhase: null })
      }
    }
  }, [batch, currentRunId, cancelling, stopTimers])

  // Clear the current run so the page can show its form again ("Generate another").
  // Keeps the workflow chat for reuse but drops the persisted run so it won't rehydrate.
  const reset = useCallback(() => {
    Object.values(runUnsubscribesRef.current).forEach((fn) => fn())
    runUnsubscribesRef.current = {}
    Object.values(pollIntervalRef.current).forEach((t) => window.clearInterval(t))
    pollIntervalRef.current = {}
    stallWatchdogRef.current.clear()
    runDeltaIndexesRef.current = {}
    setMessages([])
    setRunStates({})
    setCurrentRunId(null)
    setActivePhase(null)
    setSending(false)
    setPendingAttachments([])
    setAttachmentErrors([])
    if (persistIdRef.current) clearGenerationRun(persistIdRef.current)
  }, [])

  /**
   * Record a terminal action's result (an exported doc, a created game) onto the
   * message it came from. The backend stamps the same fields onto the stored
   * message, but only a remount would re-read them — patching here is what lets
   * the workflow reach its final step while the user is still on the page.
   */
  const markArtifactDelivered = useCallback(
    (messageId: string, patch: Record<string, unknown>) => {
      setMessages((prev) =>
        prev.map((m) =>
          m.message_id === messageId
            ? { ...m, metadata: { ...(m.metadata || {}), ...patch } }
            : m,
        ),
      )
    },
    [],
  )

  // ---- attachments (optional) ----

  const uploadAttachmentFiles = useCallback(
    async (files: File[]) => {
      if (!files.length || !batch || attachmentsUploading) return
      const activeChat = await ensureChat()
      if (!activeChat) return
      const errors: string[] = []
      const slots = Math.max(0, 5 - pendingAttachments.length)
      const chosen = files.slice(0, slots)
      if (files.length > slots) errors.push('A generation can include at most 5 attachments.')
      setAttachmentsUploading(true)
      setAttachmentErrors(errors)
      for (const file of chosen) {
        try {
          const attachment = await uploadChatAttachment(batch.id, activeChat.chat_id, file)
          const previewUrl = attachment.attachment_kind === 'image' ? URL.createObjectURL(file) : undefined
          setPendingAttachments((prev) => [...prev, { ...attachment, previewUrl }])
        } catch (err) {
          const detail = axios.isAxiosError(err) ? err.response?.data?.detail : ''
          errors.push(`${file.name}: ${typeof detail === 'string' ? detail : 'Upload failed.'}`)
        }
      }
      setAttachmentErrors([...errors])
      setAttachmentsUploading(false)
    },
    [batch, attachmentsUploading, ensureChat, pendingAttachments.length],
  )

  const removePendingAttachment = useCallback(
    async (attachmentId: string) => {
      const removed = pendingAttachments.find((a) => a.attachment_id === attachmentId)
      if (!removed) return
      try {
        await deleteChatAttachment(removed.batch_id, removed.chat_id, attachmentId)
        if (removed.previewUrl) URL.revokeObjectURL(removed.previewUrl)
        setPendingAttachments((prev) => prev.filter((a) => a.attachment_id !== attachmentId))
      } catch (err) {
        const detail = axios.isAxiosError(err) ? err.response?.data?.detail : ''
        setAttachmentErrors([`${removed.file_name}: ${typeof detail === 'string' ? detail : 'Could not remove attachment.'}`])
      }
    },
    [pendingAttachments],
  )

  return {
    chat,
    messages,
    runStates,
    currentRunId,
    activePhase,
    sending,
    cancelling,
    cancelRun,
    pendingAttachments,
    attachmentsUploading,
    attachmentErrors,
    generate,
    approveOutline,
    sendFollowUp,
    markArtifactDelivered,
    reset,
    uploadAttachmentFiles,
    removePendingAttachment,
  }
}

export type GenerationRunState = ReturnType<typeof useGenerationRun>
