import { ChevronDown, ChevronRight } from 'lucide-react'
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
    <div className="rounded-md border border-slate-200/80 bg-white/80">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2 px-2.5 py-2 text-left text-xs font-medium text-slate-700"
      >
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 flex-shrink-0 text-slate-500" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 flex-shrink-0 text-slate-500" />
        )}
        <span>Thinking</span>
        {!open && (
          <span className="min-w-0 flex-1 truncate font-normal text-slate-500">
            {collapsedSummary}
          </span>
        )}
      </button>

      {open && (
        <div className="space-y-2 border-t border-slate-100 px-2.5 py-2">
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
                  className="rounded-md border border-slate-200/70 bg-slate-50/60 px-2.5 py-2"
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
      )}
    </div>
  )
}
