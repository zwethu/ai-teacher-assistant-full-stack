import { ChevronDown } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { AgentRunEvent, AgentRunStatus } from '../../../../services/agentRunStream'

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
  const showPlaceholder = runStatus === 'running' && !hasEvents

  const collapsedSummary = useMemo(() => {
    if (showPlaceholder) return 'Waiting for agent working notes...'
    if (!hasEvents) return ''

    if (runStatus === 'done' || runStatus === 'failed') {
      const summaryEvents = thinkingEvents.filter((event) => eventMode(event) === 'summary')
      if (summaryEvents.length > 0) {
        return eventSummary(summaryEvents[summaryEvents.length - 1])
      }
    }

    return eventSummary(thinkingEvents[thinkingEvents.length - 1])
  }, [hasEvents, showPlaceholder, thinkingEvents, runStatus])

  const [open, setOpen] = useState(false)

  if (!hasEvents && !showPlaceholder) return null

  return (
    <div className="pl-3 border-l-2 border-slate-200/70">
      <button
        type="button"
        onClick={expandable ? () => setOpen((value) => !value) : undefined}
        disabled={!expandable}
        className={`flex w-full items-center gap-2 py-1.5 text-left text-xs font-medium text-slate-500 ${
          expandable ? '' : 'cursor-default'
        }`}
      >
        {expandable && (
          <ChevronDown
            className={`h-3.5 w-3.5 flex-shrink-0 text-slate-500 transition-transform duration-200 ${
              open ? 'rotate-0' : '-rotate-90'
            }`}
          />
        )}
        {runStatus === 'running' && (
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
        )}
        <span>Thinking</span>
        {(!open || !expandable) && (
          <span className="min-w-0 flex-1 truncate font-normal text-slate-500">
            {collapsedSummary}
          </span>
        )}
      </button>

      <div
        className="grid transition-all duration-200 ease-in-out"
        style={{ gridTemplateRows: expandable && open ? '1fr' : '0fr' }}
      >
        <div className="overflow-hidden">
          <div className="space-y-2 pt-1.5">
            {showPlaceholder ? (
              <p className="text-[11px] leading-5 text-slate-500">
                Waiting for agent working notes...
              </p>
            ) : (
              <>
                <div className="space-y-1.5">
                  {thinkingEvents.map((event) => {
                    const mode = eventMode(event)
                    const rawText = eventRawText(event)
                    const summary = eventSummary(event)
                    const displayText = mode === 'public_delta' && rawText ? rawText : summary

                    return (
                      <div
                        key={event.event_id}
                        className="py-1"
                      >
                        <div className="flex items-start gap-2 text-xs">
                          <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-slate-400" />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[11px] leading-5 text-slate-600">{displayText}</p>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
