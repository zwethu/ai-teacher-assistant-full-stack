import { ChevronDown } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { AgentRunEvent, AgentRunStatus } from '../../../../services/agentRunStream'
import { Thinking } from '../../../../design-system'

type Props = {
  events: AgentRunEvent[]
  runStatus: AgentRunStatus
  // When false, the panel shows the live latest thought but cannot be expanded
  // (used during generation so the streaming thinking stays put and read-only).
  expandable?: boolean
}

function eventMode(event: AgentRunEvent): string {
  const mode = event.detail?.mode
  return typeof mode === 'string' ? mode : ''
}

function eventRawText(event: AgentRunEvent): string {
  const text = event.detail?.text
  return typeof text === 'string' ? text : ''
}

function eventSummary(event: AgentRunEvent): string {
  return event.summary || event.title || eventRawText(event) || 'Working...'
}

/**
 * Once a run is finished the individual notes stop being useful at a glance, so
 * the collapsed row reports how long the agent thought instead of replaying its
 * last thought. Falls back to a count when the events carry no usable clock.
 */
function thoughtSummary(events: AgentRunEvent[]): string {
  const stamps = events
    .map((event) => event.created_at)
    .filter((t): t is number => typeof t === 'number' && t > 0)

  if (stamps.length >= 2) {
    // created_at may arrive as epoch seconds or milliseconds.
    const toMs = (t: number) => (t > 1e12 ? t : t * 1000)
    const seconds = Math.round((toMs(Math.max(...stamps)) - toMs(Math.min(...stamps))) / 1000)
    if (seconds >= 1) {
      const m = Math.floor(seconds / 60)
      const s = seconds % 60
      return m > 0 ? `Thought for ${m}m ${s}s` : `Thought for ${s}s`
    }
  }

  const n = events.length
  return `Thought ${n} time${n === 1 ? '' : 's'}`
}

export function ThinkingPanel({ events, runStatus, expandable = true }: Props) {
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
  const hasEvents = thinkingEvents.length > 0
  const isRunning = runStatus === 'running'
  const showPlaceholder = isRunning && !hasEvents

  const collapsedSummary = useMemo(() => {
    if (showPlaceholder) return 'Waiting for agent working notes...'
    if (!hasEvents) return ''

    if (runStatus === 'done' || runStatus === 'failed' || runStatus === 'cancelled') {
      // Finished — including stopped by the lecturer. Report the duration, not
      // whatever thought happened to be last.
      return thoughtSummary(thinkingEvents)
    }

    return eventSummary(thinkingEvents[thinkingEvents.length - 1])
  }, [hasEvents, showPlaceholder, thinkingEvents, runStatus])

  const [open, setOpen] = useState(false)
  const label = open && isRunning ? 'Thinking' : collapsedSummary

  if (!hasEvents && !showPlaceholder) return null

  return (
    <div>
      {/* While running, the garland carries the "agent is thinking" signal and
          the live note streams beside it. Once finished, both go away and the
          row becomes a quiet summary matching RunDetails' "Completed N steps". */}
      <button
        type="button"
        onClick={expandable ? () => setOpen((value) => !value) : undefined}
        disabled={!expandable}
        aria-expanded={expandable ? open : undefined}
        className={`group -mx-1.5 inline-flex max-w-full items-center gap-2 rounded-md px-1.5 py-1 text-left transition-colors ${
          isRunning ? 'text-xs font-medium text-slate-500' : 'text-xs font-semibold text-slate-700'
        } ${expandable ? 'hover:bg-violet-50/70 hover:text-violet-800' : 'cursor-default'}`}
      >
        {isRunning && <Thinking size={32} className="flex-shrink-0" />}
        {/* Two nested spans because two animations are in play and a single
            element can only carry one `animation` declaration: the outer one
            breathes on the garland's 7.2s beat, the inner one replays its
            roll-up each time the text changes. The `key` is what makes that
            replay happen — React remounts the node, restarting the animation. */}
        <span
          className={`min-w-0 truncate ${
            isRunning ? `font-normal ${open ? 'text-slate-500' : 'mila-live-text'}` : ''
          }`}
        >
          <span
            key={label}
            className={`block truncate ${isRunning && !open ? 'mila-thought-swap' : ''}`}
          >
            {label}
          </span>
        </span>
        {/* Chevron is hidden until hover — see RunDetails for the reasoning. */}
        {expandable && (
          <ChevronDown
            className={`h-3.5 w-3.5 flex-shrink-0 text-violet-600 opacity-0 transition-all duration-200 group-hover:opacity-100 group-focus-visible:opacity-100 ${
              open ? 'rotate-0' : '-rotate-90'
            }`}
          />
        )}
      </button>

      <div
        className="grid transition-all duration-200 ease-in-out"
        style={{ gridTemplateRows: expandable && open ? '1fr' : '0fr' }}
      >
        <div className="overflow-hidden">
          <div className="space-y-2 pt-1.5">
            {showPlaceholder ? (
              <p className="mila-live-text mila-thought-in text-[11px] leading-5">
                Waiting for agent working notes...
              </p>
            ) : (
              <div className="space-y-1.5">
                {thinkingEvents.map((event, index) => {
                  const mode = eventMode(event)
                  const rawText = eventRawText(event)
                  const summary = eventSummary(event)
                  const displayText = mode === 'public_delta' && rawText ? rawText : summary
                  // Only the newest note is "live" — pulsing every historical
                  // line at once would be noise rather than signal.
                  const isLive = isRunning && index === thinkingEvents.length - 1

                  return (
                    <div
                      key={event.event_id}
                      className="mila-thought-in relative -mx-1.5 rounded-md px-1.5 py-1"
                    >
                      {isLive && (
                        <span
                          aria-hidden
                          className="mila-thought-flash pointer-events-none absolute inset-0 rounded-md"
                        />
                      )}
                      <div className="relative flex items-start gap-2 text-xs">
                        <span
                          className={`mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full ${
                            isLive ? 'animate-pulse bg-violet-500' : 'bg-slate-400'
                          }`}
                        />
                        <div className="min-w-0 flex-1">
                          <p
                            className={`truncate text-[11px] leading-5 ${
                              isLive ? 'mila-live-text' : 'text-slate-600'
                            }`}
                          >
                            {displayText}
                          </p>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
