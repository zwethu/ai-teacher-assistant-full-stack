import { useEffect, useMemo, useState } from 'react'
import type { AgentRunEvent, AgentRunStatus } from '../../../../services/agentRunStream'
import { Spinner, Thinking } from '../../../../design-system'
import { useExitDelay } from '../../../../hooks/useExitDelay'
import { STEP_EXIT_MS } from './StepsPanel'

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
        // Only REAL agent thoughts drive the garland. The backend's synthetic
        // "Reading your request…" note (backend.run.started) covers the prep
        // window — preflight, session append, engine pickup — before the agent
        // exists; presenting it as a thought misrepresents that phase, so it is
        // silent here and the pre-agent window renders as a bare spinner below.
        .filter(
          (event) =>
            event.kind === 'thinking' && event.event_type !== 'backend.run.started',
        )
        // Stable sort on the timestamp alone — see `appendRunEvent`. Breaking
        // ties on `event_id` picked a random note out of each second, so the
        // line showed an arbitrary thought and could appear to go backwards.
        .sort((a, b) => (a.created_at || 0) - (b.created_at || 0)),
    [events],
  )
  const isRunning = runStatus === 'running'
  const hasEvents = thinkingEvents.length > 0

  const liveLabel = useMemo(() => {
    if (!hasEvents) return ''
    return eventSummary(thinkingEvents[thinkingEvents.length - 1])
  }, [hasEvents, thinkingEvents])

  // Held so the line leaves saying what it last said. Without this it would
  // swap to a stale or empty label for the 200ms it spends on its way out.
  const [lastLabel, setLastLabel] = useState(liveLabel)
  useEffect(() => {
    if (isRunning && liveLabel) setLastLabel(liveLabel)
  }, [isRunning, liveLabel])

  const mounted = useExitDelay(isRunning, STEP_EXIT_MS)
  if (!mounted) return null

  const label = isRunning ? liveLabel : lastLabel

  return (
    /* One row for both phases, so the pre-agent loader and the thinking line
       are the same box in the same place at the same size — 32px mark, same
       padding, same baseline. They used to be an 18px spinner in a narrower
       row and a 32px garland in a wider one, so the moment the agent's first
       note arrived the whole row jumped and changed shape.

       Wrapped rather than carrying the collapse itself: `.mila-step-row` sets
       `display: grid`, which would fight the row's own `inline-flex`. Same
       construction the step rows use, so the thinking line and the steps under
       it leave on identical terms. */
    <div className="mila-step-row" data-leaving={isRunning ? undefined : 'true'}>
      <div className="-mx-1.5 mt-2 inline-flex max-w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-[13px] font-medium text-slate-600">
        {/* Both marks are mounted and crossfaded rather than swapped. They are
            different animations on purpose — the Spinner's garland strings
            itself for *loading*, the Thinking mark walks its gold bead for
            *agent work*, and MILA never interchanges them — so the handover has
            to read as one becoming the other rather than one being replaced.
            Stacked absolutely in a fixed 32px box, so neither can shift the
            row while the other fades. */}
        <span className="relative inline-flex h-8 w-8 flex-shrink-0 items-center justify-center">
          <span
            className="absolute inset-0 inline-flex items-center justify-center transition-opacity duration-300 ease-out"
            style={{ opacity: label ? 0 : 1 }}
            aria-hidden={label ? true : undefined}
          >
            <Spinner size={32} tone="muted" />
          </span>
          <span
            className="absolute inset-0 inline-flex items-center justify-center transition-opacity duration-300 ease-out"
            style={{ opacity: label ? 1 : 0 }}
            aria-hidden={label ? undefined : true}
          >
            <Thinking size={32} />
          </span>
        </span>
        {/* One span now. There were two because two animations were in play
            and an element can only carry one `animation` declaration — the
            outer breathing on the garland's beat, the inner replaying its
            roll-up. The ambient breathe is gone (notes arrive often enough that
            the roll-up already says "still working"), so the nesting went with
            it. The `key` is what replays the roll-up: React remounts the node,
            restarting the animation. */}
        {label && (
          <span key={label} className="mila-thought-swap min-w-0 truncate font-normal">
            {label}
          </span>
        )}
      </div>
    </div>
  )
}
