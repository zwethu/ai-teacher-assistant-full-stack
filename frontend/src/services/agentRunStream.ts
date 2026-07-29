import {
  child,
  get,
  onChildAdded,
  onChildChanged,
  onValue,
  ref,
} from 'firebase/database'
import type { ChatMessage } from '../entity/Chat'
import { rtdb } from '../lib/firebase'

// awaiting_attachments: run is created but held until its files finish processing.
export type AgentRunStatus = 'awaiting_attachments' | 'running' | 'done' | 'failed' | 'cancelled'

export type AgentRunEvent = {
  event_id: string
  run_id?: string
  schema_version?: string
  source?: string
  event_type?: string
  kind:
    | 'process'
    | 'tool'
    | 'thinking'
    | 'retrieval'
    | 'artifact'
    | 'error'
    | 'message'
    | string
  status?: 'started' | 'running' | 'success' | 'failed' | 'done' | string
  title?: string
  summary?: string
  detail?: Record<string, unknown>
  phase?: string
  agent?: string
  tool_name?: string
  tool_call_id?: string
  parent_id?: string
  created_at?: number
}

export type AgentRunStep = {
  step_id: string
  title: string
  status: 'started' | 'running' | 'done' | 'failed' | string
  agent?: string
  detail?: Record<string, unknown>
  updated_at?: number
}

export type AgentRunDelta = {
  index: number
  delta: string
  source?: string
  mode?: string
  upstream_event_kind?: string
  created_at?: number
}

export type AgentRunStreamMeta = {
  done?: boolean
  chunk_count?: number
  final_length?: number
  response_started?: boolean
  updated_at?: number
}

type SubscribeAgentRunOptions = {
  onStatus?: (status: AgentRunStatus) => void
  onMessage?: (message: Omit<ChatMessage, 'chat_id'>) => void
  onEvent?: (event: AgentRunEvent) => void
  onStep?: (step: AgentRunStep) => void
  onDelta?: (delta: AgentRunDelta) => void
  onStreamMeta?: (meta: AgentRunStreamMeta) => void
  onRunError?: (message: string) => void
  onError?: (error: Error) => void
  onDisconnected?: (connected: boolean) => void
}

export function subscribeAgentRun(
  runId: string,
  options: SubscribeAgentRunOptions,
): () => void {
  try {
    const runRef = ref(rtdb, `agentRuns/${runId}`)
    const seenEvents = new Set<string>()
    const seenMessages = new Set<string>()
    const seenDeltaIndexes = new Set<number>()

    const handleError = (error: Error) => {
      options.onError?.(error)
    }

    void loadExistingRunSnapshot(
      runId,
      runRef,
      options,
      seenEvents,
      seenMessages,
      seenDeltaIndexes,
    ).catch(handleError)

    const unsubscribers = [
      onValue(
        ref(rtdb, '.info/connected'),
        (snapshot) => {
          options.onDisconnected?.(snapshot.val() === true)
        },
        handleError,
      ),
      onValue(
        child(runRef, 'status'),
        (snapshot) => {
          const status = snapshot.val()
          if (
            status === 'awaiting_attachments' ||
            status === 'running' ||
            status === 'done' ||
            status === 'failed'
          ) {
            options.onStatus?.(status)
          }
        },
        handleError,
      ),
      onValue(
        child(runRef, 'error'),
        (snapshot) => {
          const value = snapshot.val() as { message?: string } | string | null
          if (!value) return
          const message = typeof value === 'string' ? value : value.message
          if (message) {
            options.onRunError?.(String(message))
          }
        },
        handleError,
      ),
      onValue(
        child(runRef, 'stream_meta'),
        (snapshot) => {
          const meta = normalizeStreamMeta(snapshot.val())
          if (meta) options.onStreamMeta?.(meta)
        },
        handleError,
      ),
      onChildAdded(
        child(runRef, 'messages'),
        (snapshot) => {
          const message = normalizeMessage(snapshot.key, runId, snapshot.val())
          if (!message || seenMessages.has(message.message_id)) return
          seenMessages.add(message.message_id)
          options.onMessage?.(message)
        },
        handleError,
      ),
      onChildAdded(
        child(runRef, 'stream_deltas'),
        (snapshot) => {
          const delta = normalizeDelta(snapshot.key, snapshot.val())
          if (!delta || seenDeltaIndexes.has(delta.index)) return
          seenDeltaIndexes.add(delta.index)
          options.onDelta?.(delta)
        },
        handleError,
      ),
      onChildAdded(
        child(runRef, 'events'),
        (snapshot) => {
          const event = normalizeEvent(snapshot.key, runId, snapshot.val())
          if (!event || seenEvents.has(event.event_id)) return
          seenEvents.add(event.event_id)
          options.onEvent?.(event)
        },
        handleError,
      ),
      onChildAdded(
        child(runRef, 'steps'),
        (snapshot) => {
          const step = normalizeStep(snapshot.key, snapshot.val())
          if (step) options.onStep?.(step)
        },
        handleError,
      ),
      onChildChanged(
        child(runRef, 'steps'),
        (snapshot) => {
          const step = normalizeStep(snapshot.key, snapshot.val())
          if (step) options.onStep?.(step)
        },
        handleError,
      ),
    ]

    return () => {
      unsubscribers.forEach((unsubscribe) => unsubscribe())
    }
  } catch (error) {
    options.onError?.(error instanceof Error ? error : new Error(String(error)))
    return () => undefined
  }
}

async function loadExistingRunSnapshot(
  runId: string,
  runRef: ReturnType<typeof ref>,
  options: SubscribeAgentRunOptions,
  seenEvents: Set<string>,
  seenMessages: Set<string>,
  seenDeltaIndexes: Set<number>,
): Promise<void> {
  const [eventsSnap, stepsSnap, messagesSnap, deltasSnap, streamMetaSnap] = await Promise.all([
    get(child(runRef, 'events')),
    get(child(runRef, 'steps')),
    get(child(runRef, 'messages')),
    get(child(runRef, 'stream_deltas')),
    get(child(runRef, 'stream_meta')),
  ])

  if (deltasSnap.exists()) {
    const raw = deltasSnap.val() as Record<string, unknown>
    const deltas = Object.entries(raw)
      .map(([key, value]) => normalizeDelta(key, value))
      .filter((delta): delta is AgentRunDelta => Boolean(delta))
      .sort((a, b) => a.index - b.index)

    for (const delta of deltas) {
      if (seenDeltaIndexes.has(delta.index)) continue
      seenDeltaIndexes.add(delta.index)
      options.onDelta?.(delta)
    }
  }

  if (streamMetaSnap.exists()) {
    const meta = normalizeStreamMeta(streamMetaSnap.val())
    if (meta) options.onStreamMeta?.(meta)
  }

  if (eventsSnap.exists()) {
    const raw = eventsSnap.val() as Record<string, unknown>
    for (const [key, value] of Object.entries(raw)) {
      const event = normalizeEvent(key, runId, value)
      if (!event || seenEvents.has(event.event_id)) continue
      seenEvents.add(event.event_id)
      options.onEvent?.(event)
    }
  }

  if (stepsSnap.exists()) {
    const raw = stepsSnap.val() as Record<string, unknown>
    for (const [key, value] of Object.entries(raw)) {
      const step = normalizeStep(key, value)
      if (step) options.onStep?.(step)
    }
  }

  if (messagesSnap.exists()) {
    const raw = messagesSnap.val() as Record<string, unknown>
    for (const [key, value] of Object.entries(raw)) {
      const message = normalizeMessage(key, runId, value)
      if (!message || seenMessages.has(message.message_id)) continue
      seenMessages.add(message.message_id)
      options.onMessage?.(message)
    }
  }
}

function normalizeMessage(
  key: string | null,
  runId: string,
  raw: unknown,
): Omit<ChatMessage, 'chat_id'> | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Partial<ChatMessage> & { created_at?: unknown }
  const messageId = String(value.message_id || key || `rtdb-${runId}`)
  return {
    message_id: messageId,
    role: value.role === 'user' ? 'user' : 'assistant',
    content: String(value.content || ''),
    created_at: normalizeTimestamp(value.created_at),
    status: 'done',
    run_id: runId,
    metadata: isRecord(value.metadata) ? value.metadata : undefined,
  }
}

function normalizeEvent(
  key: string | null,
  runId: string,
  raw: unknown,
): AgentRunEvent | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Record<string, unknown>
  const event = {
    event_id: String(value.event_id || key || `${runId}-event`),
    run_id: String(value.run_id || runId),
    schema_version: value.schema_version ? String(value.schema_version) : undefined,
    source: value.source ? String(value.source) : undefined,
    event_type: value.event_type ? String(value.event_type) : undefined,
    kind: String(value.kind || 'process'),
    status: value.status ? String(value.status) : undefined,
    title: value.title ? String(value.title) : undefined,
    summary: value.summary ? String(value.summary) : undefined,
    detail: isRecord(value.detail) ? value.detail : undefined,
    phase: value.phase ? String(value.phase) : undefined,
    agent: value.agent ? String(value.agent) : undefined,
    tool_name: value.tool_name ? String(value.tool_name) : undefined,
    tool_call_id: value.tool_call_id ? String(value.tool_call_id) : undefined,
    parent_id: value.parent_id ? String(value.parent_id) : undefined,
    created_at: toNumber(value.created_at),
  }
  if (import.meta.env.DEV && event.kind === 'thinking') {
    console.debug('[agentRunStream] thinking event', event)
  }
  return event
}

function normalizeDelta(key: string | null, raw: unknown): AgentRunDelta | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Record<string, unknown>
  const indexFromValue = Number(value.index)
  const indexFromKey = key ? Number(key) : NaN
  const index = Number.isFinite(indexFromValue) ? indexFromValue : indexFromKey
  if (!Number.isFinite(index)) return null
  const delta = typeof value.delta === 'string' ? value.delta : ''
  if (!delta) return null
  return {
    index,
    delta,
    source: value.source ? String(value.source) : undefined,
    mode: value.mode ? String(value.mode) : undefined,
    upstream_event_kind: value.upstream_event_kind
      ? String(value.upstream_event_kind)
      : undefined,
    created_at: toNumber(value.created_at),
  }
}

function normalizeStreamMeta(raw: unknown): AgentRunStreamMeta | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Record<string, unknown>
  return {
    done: typeof value.done === 'boolean' ? value.done : undefined,
    chunk_count: toNumber(value.chunk_count),
    final_length: toNumber(value.final_length),
    response_started:
      typeof value.response_started === 'boolean'
        ? value.response_started
        : undefined,
    updated_at: toNumber(value.updated_at),
  }
}

function normalizeStep(key: string | null, raw: unknown): AgentRunStep | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Record<string, unknown>
  return {
    step_id: String(value.step_id || key || 'step'),
    title: String(value.title || value.step || key || 'Working'),
    status: String(value.status || 'running'),
    agent: value.agent ? String(value.agent) : undefined,
    detail: isRecord(value.detail) ? value.detail : undefined,
    updated_at: toNumber(value.updated_at),
  }
}

function normalizeTimestamp(value: unknown): string {
  const numeric = toNumber(value)
  if (numeric) {
    return new Date(numeric < 10_000_000_000 ? numeric * 1000 : numeric).toISOString()
  }
  return typeof value === 'string' ? value : new Date().toISOString()
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}
