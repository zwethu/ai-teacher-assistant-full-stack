import { ChevronDown } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { AgentRunEvent, AgentRunStatus } from '../../../../services/agentRunStream'

type Props = {
  events: AgentRunEvent[]
  runStatus: AgentRunStatus
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

function formatTime(value?: number): string {
  if (!value) return ''
  const ms = value < 10_000_000_000 ? value * 1000 : value
  return new Date(ms).toLocaleTimeString()
}

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

  const collapsedSummary = useMemo(() => {
    if (thinkingEvents.length === 0) return ''

    if (runStatus === 'done' || runStatus === 'failed') {
      const summaryEvents = thinkingEvents.filter((event) => eventMode(event) === 'summary')
      if (summaryEvents.length > 0) {
        return eventSummary(summaryEvents[summaryEvents.length - 1])
      }
    }

    return eventSummary(thinkingEvents[thinkingEvents.length - 1])
  }, [thinkingEvents, runStatus])

  const defaultOpen = runStatus === 'running' && thinkingEvents.length > 0
  const [open, setOpen] = useState(defaultOpen)

  useEffect(() => {
    if (runStatus === 'done' || runStatus === 'failed') {
      setOpen(false)
    } else if (runStatus === 'running' && thinkingEvents.length > 0) {
      setOpen(true)
    }
  }, [runStatus, thinkingEvents.length])

  if (thinkingEvents.length === 0) return null

  return (
    <div className="pl-3 border-l-2 border-slate-200/70">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2 py-1.5 text-left text-xs font-medium text-slate-500"
      >
        <ChevronDown
          className={`h-3.5 w-3.5 flex-shrink-0 text-slate-500 transition-transform duration-200 ${
            open ? 'rotate-0' : '-rotate-90'
          }`}
        />
        {runStatus === 'running' && !open && (
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
        )}
        <span>Thinking</span>
        {!open && (
          <span className="min-w-0 flex-1 truncate font-normal text-slate-500">
            {collapsedSummary}
          </span>
        )}
      </button>

      <div
        className="grid transition-all duration-200 ease-in-out"
        style={{ gridTemplateRows: open ? '1fr' : '0fr' }}
      >
        <div className="overflow-hidden">
          <div className="space-y-2 pt-1.5">
            <p className="text-[11px] text-slate-500">Public working notes from the agent</p>
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
                        <p className="text-[11px] leading-5 text-slate-600">{displayText}</p>
                        {event.created_at && (
                          <div className="mt-1 text-[10px] text-slate-400">
                            {formatTime(event.created_at)}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
