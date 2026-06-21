import { ChevronDown, ChevronRight, Wrench } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import type { AgentRunEvent, AgentRunStep } from '../../../../services/agentRunStream'

type RowItem =
  | { type: 'step'; data: AgentRunStep }
  | { type: 'event'; data: AgentRunEvent }

type Props = {
  item: RowItem
}

export function StepTimelineRow({ item }: Props) {
  const [open, setOpen] = useState(false)

  if (item.type === 'step') {
    return <StepRow step={item.data} open={open} onToggle={() => setOpen((v) => !v)} />
  }
  return <EventRow event={item.data} open={open} onToggle={() => setOpen((v) => !v)} />
}

function StepRow({
  step,
  open,
  onToggle,
}: {
  step: AgentRunStep
  open: boolean
  onToggle: () => void
}) {
  const prefix = step.agent ? `Progress: ${step.title}` : `Progress: ${step.title}`
  return (
    <CollapsibleRow
      open={open}
      onToggle={onToggle}
      icon={<ChevronIcon open={open} />}
      title={prefix}
      status={step.status}
      expanded={
        <>
          {step.agent && <div className="text-slate-500">Agent: {step.agent}</div>}
          {step.detail && Object.keys(step.detail).length > 0 && (
            <DetailBlock detail={step.detail} />
          )}
          {step.updated_at && (
            <div className="text-slate-400">
              Updated {formatTime(step.updated_at)}
            </div>
          )}
        </>
      }
    />
  )
}

function EventRow({
  event,
  open,
  onToggle,
}: {
  event: AgentRunEvent
  open: boolean
  onToggle: () => void
}) {
  const title = eventTitle(event)
  const icon =
    event.kind === 'tool' ? (
      <Wrench className="h-3.5 w-3.5 flex-shrink-0 text-slate-500" />
    ) : (
      <ChevronIcon open={open} />
    )

  const link = artifactLink(event)

  return (
    <CollapsibleRow
      open={open}
      onToggle={onToggle}
      icon={icon}
      title={title}
      status={event.status || (event.kind === 'error' ? 'failed' : 'done')}
      failed={event.status === 'failed' || event.kind === 'error'}
      expanded={
        <>
          {event.summary && event.summary !== event.title && (
            <div className="text-slate-600">{event.summary}</div>
          )}
          {event.detail && Object.keys(event.detail).length > 0 && (
            <DetailBlock detail={event.detail} />
          )}
          {event.status === 'failed' && event.summary && (
            <div className="text-red-600">{event.summary}</div>
          )}
          {link && (
            <a
              href={link}
              target="_blank"
              rel="noreferrer"
              className="font-medium text-emerald-700 underline underline-offset-2"
            >
              Open artifact
            </a>
          )}
          {event.created_at && (
            <div className="text-slate-400">
              {formatTime(event.created_at)}
            </div>
          )}
        </>
      }
    />
  )
}

function CollapsibleRow({
  open,
  onToggle,
  icon,
  title,
  status,
  failed,
  expanded,
}: {
  open: boolean
  onToggle: () => void
  icon: ReactNode
  title: string
  status: string
  failed?: boolean
  expanded: ReactNode
}) {
  return (
    <div className="rounded-md border border-slate-200/80 bg-white/80">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-2 px-2.5 py-2 text-left text-xs"
      >
        {icon}
        <span className="min-w-0 flex-1 truncate font-medium text-slate-700">{title}</span>
        <StatusBadge status={status} failed={failed} />
      </button>
      {open && (
        <div className="space-y-1.5 border-t border-slate-100 px-2.5 py-2 text-xs leading-5 text-slate-600">
          {expanded}
        </div>
      )}
    </div>
  )
}

function StatusBadge({ status, failed }: { status: string; failed?: boolean }) {
  if (failed || status === 'failed') {
    return <span className="rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-semibold text-red-700">Failed</span>
  }
  if (status === 'done' || status === 'success') {
    return <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">Done</span>
  }
  if (status === 'running' || status === 'started') {
    return <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700">Running</span>
  }
  return <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">{status}</span>
}

function ChevronIcon({ open }: { open: boolean }) {
  return open ? (
    <ChevronDown className="h-3.5 w-3.5 flex-shrink-0 text-slate-500" />
  ) : (
    <ChevronRight className="h-3.5 w-3.5 flex-shrink-0 text-slate-500" />
  )
}

function DetailBlock({ detail }: { detail: Record<string, unknown> }) {
  return (
    <pre className="max-h-40 overflow-auto rounded bg-slate-50 p-2 text-[11px] leading-4 text-slate-700">
      {JSON.stringify(detail, null, 2)}
    </pre>
  )
}

function eventTitle(event: AgentRunEvent): string {
  if (event.kind === 'tool') {
    return `Tool: ${event.tool_name || event.title || event.summary || 'tool'}`
  }
  if (event.kind === 'process') {
    return `Progress: ${event.title || event.summary || 'Working'}`
  }
  if (event.kind === 'retrieval') {
    return `Retrieval: ${event.summary || event.title || 'Sources'}`
  }
  if (event.kind === 'artifact') {
    return `Artifact: ${event.title || event.summary || 'Output'}`
  }
  if (event.kind === 'error') {
    return `Error: ${event.title || event.summary || 'Something went wrong'}`
  }
  return event.title || event.summary || event.kind
}

function artifactLink(event: AgentRunEvent): string {
  const detail = event.detail || {}
  for (const key of ['doc_url', 'form_url', 'lecturer_doc_url', 'student_doc_url']) {
    const value = detail[key]
    if (typeof value === 'string' && value.startsWith('http')) return value
  }
  return ''
}

function formatTime(value: number): string {
  const ms = value < 10_000_000_000 ? value * 1000 : value
  return new Date(ms).toLocaleTimeString()
}
