import type { AgentRunEvent, AgentRunStep } from '../../../../services/agentRunStream'

export type NormalizedRunRow = {
  id: string
  kind: 'tool' | 'progress' | 'retrieval' | 'artifact' | 'error'
  title: string
  status: string
  summary?: string
  detail?: Record<string, unknown>
  updated_at?: number
  source?: AgentRunEvent | AgentRunStep
}

const STEP_EVENT_KINDS = new Set(['process', 'tool', 'retrieval', 'artifact', 'error'])

function statusRank(status: string): number {
  const normalized = normalizeStatus(status)
  if (normalized === 'failed') return 4
  if (normalized === 'done' || normalized === 'success') return 3
  if (normalized === 'running') return 2
  if (normalized === 'started') return 1
  return 0
}

/**
 * Is this row still in flight?
 *
 * With parallel tool calling there is no single "current step": each call
 * carries its own `tool_call_id`, so a fan-out arrives as several rows that are
 * active at once and settle independently. Asking each row rather than tracking
 * a cursor is what makes one and many the same code path.
 *
 * After a run reaches a terminal status nothing is active — `normalizeRunRows`
 * rewrites anything still `running` to the run's outcome, which is also what
 * clears a row whose "done" event never arrived.
 */
export function isRowActive(row: NormalizedRunRow): boolean {
  const status = normalizeStatus(row.status)
  return status === 'running' || status === 'started'
}

export function normalizeStatus(status: string): string {
  if (status === 'error') return 'failed'
  if (status === 'success') return 'done'
  return status || 'running'
}

function eventRowId(event: AgentRunEvent): string {
  if (event.kind === 'tool') {
    return `tool:${event.tool_call_id || event.tool_name || event.phase || event.title}`
  }
  if (event.kind === 'process') {
    return `process:${event.phase || event.title || event.summary}`
  }
  if (event.kind === 'retrieval') {
    // Group all reads/analyses of one file into a single row.
    if ((event.event_type || '').startsWith('attachment.')) {
      return `attachment:${event.summary || event.title || event.event_id}`
    }
    return `retrieval:${event.phase || event.event_id}`
  }
  if (event.kind === 'artifact') return `artifact:${event.phase || event.event_id}`
  return `error:${event.phase || event.event_id}`
}

function isAttachmentEvent(event: AgentRunEvent): boolean {
  return (event.event_type || '').startsWith('attachment.')
}

function eventKind(event: AgentRunEvent): NormalizedRunRow['kind'] {
  if (event.kind === 'tool') return 'tool'
  if (event.kind === 'retrieval') return 'retrieval'
  if (event.kind === 'artifact') return 'artifact'
  if (event.kind === 'error') return 'error'
  return 'progress'
}

// Fallback for anything the agent didn't already send a friendly label for:
// turn a snake_case internal name into a readable phrase (mirrors labels.py).
const NAME_SUFFIXES = ['_if_enabled', '_agent', '_worker', '_formatter', '_generator', '_tool']
function humanizeName(raw?: string): string {
  if (!raw) return ''
  let s = raw
  for (const suffix of NAME_SUFFIXES) {
    if (s.endsWith(suffix)) { s = s.slice(0, -suffix.length); break }
  }
  s = s.replace(/_/g, ' ').trim()
  return s ? s[0].toUpperCase() + s.slice(1) : ''
}

function eventTitle(event: AgentRunEvent): string {
  // The agent now sends a friendly, plain-language `title` for tool + process
  // events (see Pnai-ai/mila/shared/labels.py); prefer it and never surface a
  // raw tool/agent name. humanizeName is only a graceful fallback.
  if (event.kind === 'tool') return event.title || humanizeName(event.tool_name) || 'Working'
  if (isAttachmentEvent(event)) {
    const file = event.summary || 'attachment'
    if ((event.event_type || '').startsWith('attachment.vision')) return `Analyzing image: ${file}`
    if ((event.event_type || '') === 'attachment.read_refused') return `Attachment skipped: ${file}`
    return `Reading attachment: ${file}`
  }
  if (event.kind === 'retrieval') return `Retrieval: ${event.summary || event.title || 'Sources'}`
  if (event.kind === 'artifact') return `Artifact: ${event.title || event.summary || 'Output'}`
  if (event.kind === 'error') return `Error: ${humanizeName(event.title) || event.summary || 'Something went wrong'}`
  return event.title || event.summary || 'Working'
}

function isTerminalStatus(status: string): boolean {
  const normalized = normalizeStatus(status)
  return normalized === 'failed' || normalized === 'done' || normalized === 'success'
}

/**
 * Events arrive in chronological order, so `next` is never older than
 * `existing`. Two rules, in priority order:
 *  - a LATER terminal status replaces an earlier one — the schema-retry loop
 *    legitimately emits failed → started → done for one phase, and the row
 *    must end on Done, not stick on the first Failed;
 *  - a terminal status never downgrades to running/started on a stray
 *    non-terminal event (the reason the old rank-only rule existed).
 */
function mergeStatus(existing: string, next: string): string {
  if (isTerminalStatus(next)) return next
  if (isTerminalStatus(existing)) return existing
  return statusRank(next) >= statusRank(existing) ? next : existing
}

function mergeRow(existing: NormalizedRunRow, next: NormalizedRunRow): NormalizedRunRow {
  const status = mergeStatus(existing.status, next.status)
  const latest =
    (next.updated_at || 0) >= (existing.updated_at || 0) ? next : existing
  return {
    ...existing,
    ...latest,
    status,
    summary: latest.summary || existing.summary,
    detail: latest.detail || existing.detail,
    updated_at: Math.max(existing.updated_at || 0, next.updated_at || 0),
  }
}

export function normalizeRunRows(
  steps: Record<string, AgentRunStep>,
  events: AgentRunEvent[],
  runStatus: string = 'running',
): NormalizedRunRow[] {
  const rows = new Map<string, NormalizedRunRow>()

  for (const step of Object.values(steps)) {
    rows.set(`step:${step.step_id}`, {
      id: `step:${step.step_id}`,
      kind: 'progress',
      title: step.title || 'Working',
      status: normalizeStatus(step.status),
      detail: step.detail,
      updated_at: step.updated_at,
      source: step,
    })
  }

  for (const event of events) {
    if (!STEP_EVENT_KINDS.has(event.kind)) continue
    if ((event.title || '').startsWith('Handing off to')) continue

    const processStepId =
      event.kind === 'process' && event.phase ? `step:${event.phase}` : ''
    const id = processStepId && rows.has(processStepId) ? processStepId : eventRowId(event)
    const next: NormalizedRunRow = {
      id,
      kind: eventKind(event),
      title: eventTitle(event),
      status: normalizeStatus(event.status || (event.kind === 'error' ? 'failed' : 'done')),
      summary: event.summary,
      detail: event.detail,
      updated_at: event.created_at,
      source: event,
    }
    const existing = rows.get(id)
    rows.set(id, existing ? mergeRow(existing, next) : next)
  }

  const terminalStatus = runStatus === 'done' ? 'done' : runStatus === 'failed' ? 'failed' : ''
  return [...rows.values()]
    .map((row) => {
      if (!terminalStatus || !['running', 'started'].includes(normalizeStatus(row.status))) {
        return row
      }
      return { ...row, status: terminalStatus }
    })
    .sort((a, b) => (a.updated_at || 0) - (b.updated_at || 0))
}
