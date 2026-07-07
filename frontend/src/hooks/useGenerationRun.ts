import { useCallback, useEffect, useRef, useState } from 'react'
import axios from 'axios'
import type { Batch } from '../entity/Batch'
import type { Chat, ChatAttachment, ChatMessage } from '../entity/Chat'
import {
  createChat,
  deleteChatAttachment,
  getChatAttachmentRagStatus,
  listMessages,
  sendMessage,
  uploadChatAttachment,
} from '../services/chatService'
import { invokeAgent } from '../services/agentService'
import { clearGenerationRun, readGenerationRun, writeGenerationRun } from './generationRunStore'
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

export type GenerationWorkflow = 'lesson_plan' | 'assessment' | 'lab' | 'course_blueprint'

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
  const [pendingAttachments, setPendingAttachments] = useState<PendingChatAttachment[]>([])
  const [attachmentsUploading, setAttachmentsUploading] = useState(false)
  const [attachmentErrors, setAttachmentErrors] = useState<string[]>([])

  const runUnsubscribesRef = useRef<Record<string, () => void>>({})
  const runDeltaIndexesRef = useRef<Record<string, Set<number>>>({})
  const fallbackTimerRef = useRef<Record<string, number>>({})
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
    Object.values(fallbackTimerRef.current).forEach((t) => window.clearTimeout(t))
    fallbackTimerRef.current = {}
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
    const refresh = async () => {
      const updates = await Promise.all(
        transitional.map(async (item) => {
          try { return await getChatAttachmentRagStatus(batchId, activeChatId, item.attachment_id) }
          catch { return null }
        }),
      )
      if (cancelled) return
      setPendingAttachments((current) =>
        current.map((item) => {
          const update = updates.find((v) => v?.attachment_id === item.attachment_id)
          return update ? { ...item, ...update } : item
        }),
      )
    }
    const timer = window.setInterval(() => void refresh(), 2500)
    void refresh()
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [batchId, chat?.chat_id, pendingAttachments.map((a) => `${a.attachment_id}:${a.status}`).join('|')])

  useEffect(() => () => {
    Object.values(runUnsubscribesRef.current).forEach((fn) => fn())
    Object.values(pollIntervalRef.current).forEach((t) => window.clearInterval(t))
    Object.values(fallbackTimerRef.current).forEach((t) => window.clearTimeout(t))
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
      const events = current.events.some((e) => e.event_id === event.event_id)
        ? current.events
        : [...current.events, event].sort(
            (a, b) => (a.created_at || 0) - (b.created_at || 0) || a.event_id.localeCompare(b.event_id),
          )
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
    if (fallbackTimerRef.current[runId]) {
      window.clearTimeout(fallbackTimerRef.current[runId])
      delete fallbackTimerRef.current[runId]
    }
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

  const subscribeToRun = useCallback(
    (runId: string, chatId: string) => {
      if (runUnsubscribesRef.current[runId]) return
      const pendingId = `pending-${runId}`
      ensureRunState(runId)
      runUnsubscribesRef.current[runId] = subscribeAgentRun(runId, {
        onMessage: (m) => { upsertFinalMessage(m, pendingId, chatId); setSending(false); stopTimers(runId) },
        onStatus: (status) => {
          updateRunStatus(runId, status)
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
        },
        onEvent: (e) => appendRunEvent(runId, e),
        onStep: (s) => upsertRunStep(runId, s),
        onDelta: (d) => appendRunDelta(runId, d, chatId, pendingId),
        onStreamMeta: (meta) => updateRunStreamMeta(runId, meta),
        onRunError: (msg) => updateRunError(runId, msg),
        onDisconnected: (connected) => updateRunConnection(runId, connected),
        onError: (err) => {
          console.error(err)
          updateRunStreamError(runId, STREAM_DELAY_MESSAGE)
          if (pollIntervalRef.current[runId]) return
          pollIntervalRef.current[runId] = window.setInterval(() => {
            void pollFinalOnce(chatId, runId, pendingId).catch(console.error)
          }, 5000)
        },
      })
      // 10s live-stall fallback → start polling.
      fallbackTimerRef.current[runId] = window.setTimeout(() => {
        updateRunStreamError(runId, STREAM_DELAY_MESSAGE)
        if (pollIntervalRef.current[runId]) return
        pollIntervalRef.current[runId] = window.setInterval(() => {
          void pollFinalOnce(chatId, runId, pendingId).catch(console.error)
        }, 5000)
      }, 10000)
    },
    [ensureRunState, upsertFinalMessage, stopTimers, updateRunStatus, appendRunEvent, upsertRunStep,
     appendRunDelta, updateRunStreamMeta, updateRunError, updateRunConnection, updateRunStreamError, pollFinalOnce],
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
      setActivePhase('outline')
      if (persistIdRef.current) writeGenerationRun(persistIdRef.current, { activePhase: 'outline' })
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
            workflow_stage: 'outline',
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
    async (text: string, webSearch = true) => {
      const content = text.trim()
      if (!batch || !content || sending || !chatRef.current) return
      setActivePhase('refine')
      if (persistIdRef.current) writeGenerationRun(persistIdRef.current, { activePhase: 'refine' })
      const chatId = chatRef.current.chat_id
      await startRun(chatId, content, async () => {
        const data = await sendMessage(batch.id, chatId, content, { web_search: webSearch }, [])
        return data as InvokeResult
      })
    },
    [batch, sending, startRun],
  )

  // Clear the current run so the page can show its form again ("Generate another").
  // Keeps the workflow chat for reuse but drops the persisted run so it won't rehydrate.
  const reset = useCallback(() => {
    Object.values(runUnsubscribesRef.current).forEach((fn) => fn())
    runUnsubscribesRef.current = {}
    Object.values(pollIntervalRef.current).forEach((t) => window.clearInterval(t))
    pollIntervalRef.current = {}
    Object.values(fallbackTimerRef.current).forEach((t) => window.clearTimeout(t))
    fallbackTimerRef.current = {}
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
    pendingAttachments,
    attachmentsUploading,
    attachmentErrors,
    generate,
    approveOutline,
    sendFollowUp,
    reset,
    uploadAttachmentFiles,
    removePendingAttachment,
  }
}

export type GenerationRunState = ReturnType<typeof useGenerationRun>
