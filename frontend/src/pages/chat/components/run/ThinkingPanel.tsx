import { ChevronDown, ChevronRight } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { AgentRunEvent } from '../../../../services/agentRunStream'

type Props = {
  events: AgentRunEvent[]
}

export function ThinkingPanel({ events }: Props) {
  const [open, setOpen] = useState(false)
  const summaries = useMemo(() => {
    const thinking = events.filter((event) => event.kind === 'thinking')
    const fallback = events.filter((event) =>
      ['process', 'tool', 'retrieval'].includes(event.kind),
    )
    return [...thinking, ...fallback]
      .map((event) => event.summary || event.title)
      .filter((summary): summary is string => Boolean(summary))
      .slice(-8)
  }, [events])

  const latest = summaries.at(-1) || 'Working through the request...'

  return (
    <div className="rounded-lg border border-slate-200 bg-white/65">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-slate-700"
      >
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        <span>Thinking summaries</span>
        <span className="min-w-0 flex-1 truncate font-normal text-slate-500">{latest}</span>
      </button>
      {open && summaries.length > 0 && (
        <div className="space-y-1 border-t border-slate-100 px-3 py-2">
          {summaries.map((summary, index) => (
            <div key={`${summary}-${index}`} className="text-xs leading-5 text-slate-600">
              {summary}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
