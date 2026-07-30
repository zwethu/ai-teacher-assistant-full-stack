/**
 * Watches a live RTDB run stream for silence.
 *
 * RTDB is the push channel for a run. The HTTP fallback exists only for when that
 * channel is genuinely unreachable — a blocked websocket, a rules problem — not
 * for slow runs. The distinction matters: the previous implementation armed a
 * one-shot 10s timer at subscribe time and never reset it, so every run longer
 * than ten seconds (which is nearly all of them) started polling the messages
 * endpoint alongside a stream that was working perfectly.
 *
 * So the deadline measures *silence*, not run length: every inbound signal pushes
 * it back, and a signal arriving after the fallback engaged winds it back down.
 */

/** How long the live channel may go quiet before the fallback takes over. */
export const STREAM_STALL_MS = 10_000

export type StallHandlers = {
  /** The stream went quiet — start the fallback. */
  onStall: () => void
  /** The stream came back after stalling — stop paying for the fallback. */
  onRecover: () => void
}

export type StallWatchdog = {
  /** Record a signal from the live channel and re-arm the deadline. */
  alive: (runId: string, handlers: StallHandlers) => void
  /** Stop watching one run, or all of them when called with no argument. */
  clear: (runId?: string) => void
  /** Whether this run is currently considered stalled. */
  isStalled: (runId: string) => boolean
}

export function createStallWatchdog(stallMs: number = STREAM_STALL_MS): StallWatchdog {
  const timers: Record<string, number> = {}
  const stalled = new Set<string>()

  function clearTimer(runId: string) {
    if (timers[runId] !== undefined) {
      window.clearTimeout(timers[runId])
      delete timers[runId]
    }
  }

  return {
    alive(runId, handlers) {
      clearTimer(runId)
      if (stalled.delete(runId)) handlers.onRecover()
      timers[runId] = window.setTimeout(() => {
        delete timers[runId]
        stalled.add(runId)
        handlers.onStall()
      }, stallMs)
    },

    clear(runId) {
      if (runId === undefined) {
        Object.keys(timers).forEach(clearTimer)
        stalled.clear()
        return
      }
      clearTimer(runId)
      stalled.delete(runId)
    },

    isStalled: (runId) => stalled.has(runId),
  }
}
