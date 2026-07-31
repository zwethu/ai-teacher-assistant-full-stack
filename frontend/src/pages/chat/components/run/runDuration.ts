import type { AgentRunEvent, AgentRunStep } from '../../../../services/agentRunStream'

/** Timestamps arrive as epoch seconds from the agent and milliseconds from the
 *  backend, and both land on the same run. */
function toMs(value: number): number {
  return value > 1e12 ? value : value * 1000
}

/**
 * How long the whole run took, from its first signal to its last.
 *
 * Measured across events *and* step nodes rather than either alone: with
 * parallel tool calls the last event to arrive is not necessarily from the last
 * step to finish, and a run whose work is all step updates has no events to
 * measure at all.
 *
 * Returns 0 when there is nothing to measure — one signal, or none carrying a
 * usable clock — which callers read as "say nothing about duration" rather than
 * printing a confident "0s".
 */
export function runDurationSeconds(
  events: AgentRunEvent[],
  steps: Record<string, AgentRunStep>,
): number {
  const stamps = [
    ...events.map((event) => event.created_at),
    ...Object.values(steps).map((step) => step.updated_at),
  ]
    .filter((value): value is number => typeof value === 'number' && value > 0)
    .map(toMs)

  if (stamps.length < 2) return 0
  return Math.round((Math.max(...stamps) - Math.min(...stamps)) / 1000)
}

/** "36s", "1m 12s". Minutes only once there are any — "0m 36s" reads as a stall. */
export function formatDuration(seconds: number): string {
  if (seconds < 1) return ''
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return m > 0 ? `${m}m ${s}s` : `${s}s`
}

/**
 * The one line a finished run collapses to. Duration first because it is the
 * part that varies meaningfully between runs; the step count qualifies it.
 */
export function runSummaryLabel(status: string, stepCount: number, duration: string): string {
  const steps = `${stepCount} step${stepCount === 1 ? '' : 's'}`
  if (!duration) {
    if (status === 'failed') return `Failed after ${steps}`
    if (status === 'cancelled') return `Stopped after ${steps}`
    return `Completed ${steps}`
  }
  const verb =
    status === 'failed' ? 'Failed after' : status === 'cancelled' ? 'Stopped after' : 'Worked for'
  return `${verb} ${duration} · ${steps}`
}
