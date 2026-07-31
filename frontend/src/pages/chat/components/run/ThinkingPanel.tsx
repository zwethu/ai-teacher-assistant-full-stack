import { useEffect, useMemo, useState } from 'react'
import type { AgentRunEvent, AgentRunStatus } from '../../../../services/agentRunStream'
import { Thinking } from '../../../../design-system'
import { useExitDelay } from '../../../../hooks/useExitDelay'

type Props = {
  events: AgentRunEvent[]
  runStatus: AgentRunStatus
}

function eventRawText(event: AgentRunEvent): string {
  const text = event.detail?.text
  return typeof text === 'string' ? text : ''
}

function eventSummary(event: AgentRunEvent): string {
  return event.summary || event.title || eventRawText(event) || 'Working...'
}

/**
 * The agent's latest thought, streamed and replaced, for exactly as long as the
 * run lasts.
 *
 * Not expandable, and it does not outlive the run. Thinking is a liveness
 * signal, not a record — the steps are the record, and RunDetails owns them.
 * Its finished summary used to read "Thought for 36s" directly above
 * "Completed 6 steps"; since both spanned nearly the same interval, that was
 * two clocks for one piece of work. The duration now lives on the run summary,
 * and this line simply ends.
 */
export function ThinkingPanel({ events, runStatus }: Props) {
  const thinkingEvents = useMemo(
    () =>
      events
        .filter((event) => event.kind === 'thinking')
        .sort(
          (a, b) =>
            (a.created_at || 0) - (b.created_at || 0) ||
            a.event_id.localeCompare(b.event_id),
        ),
    [events],
  )
  const isRunning = runStatus === 'running'
  const hasEvents = thinkingEvents.length > 0

  const liveLabel = useMemo(() => {
    if (!hasEvents) return 'Waiting for agent working notes...'
    return eventSummary(thinkingEvents[thinkingEvents.length - 1])
  }, [hasEvents, thinkingEvents])

  // Held so the line leaves saying what it last said. Without this it would
  // swap to a stale or empty label for the 200ms it spends on its way out.
  const [lastLabel, setLastLabel] = useState(liveLabel)
  useEffect(() => {
    if (isRunning) setLastLabel(liveLabel)
  }, [isRunning, liveLabel])

  const mounted = useExitDelay(isRunning)
  if (!mounted) return null

  const label = isRunning ? liveLabel : lastLabel

  return (
    /* The garland carries the "agent is thinking" signal and the live note
       streams beside it. Both leave together when the run settles. */
    <div
      className={`-mx-1.5 mt-2 inline-flex max-w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-xs font-medium text-slate-500 ${
        isRunning ? '' : 'mila-step-out'
      }`}
    >
      <Thinking size={32} className="flex-shrink-0" />
      {/* Two nested spans because two animations are in play and a single
          element can only carry one `animation` declaration: the outer one
          breathes on the garland's 7.2s beat, the inner one replays its
          roll-up each time the text changes. The `key` is what makes that
          replay happen — React remounts the node, restarting the animation. */}
      <span className="mila-live-text min-w-0 truncate font-normal">
        <span key={label} className="mila-thought-swap block truncate">
          {label}
        </span>
      </span>
    </div>
  )
}
