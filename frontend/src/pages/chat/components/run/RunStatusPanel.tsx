import {
  AlertCircle,
  CheckCircle2,
  Circle,
  Loader2,
  Wrench,
} from 'lucide-react'
import type { AgentRunEvent, AgentRunStep } from '../../../../services/agentRunStream'
import type { RunUiState } from '../../runTypes'
import { ThinkingPanel } from './ThinkingPanel'

type Props = {
  run?: RunUiState
}

export function RunStatusPanel({ run }: Props) {
  if (!run) return null

  const steps = Object.values(run.steps).sort((a, b) =>
    (a.updated_at || 0) - (b.updated_at || 0),
  )
  const timeline = run.events
    .filter((event) => event.kind !== 'thinking' && event.kind !== 'message')
    .sort((a, b) => (a.created_at || 0) - (b.created_at || 0) || a.event_id.localeCompare(b.event_id))

  return (
    <div className="mt-3 space-y-2 rounded-lg border border-slate-200 bg-slate-50/70 p-3">
      <div className="flex items-center gap-2 text-xs font-semibold text-slate-700">
        {statusIcon(run.status)}
        <span>{statusLabel(run.status)}</span>
      </div>

      {run.liveConnected === false && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-xs text-amber-800">
          Live updates disconnected. I will fetch the final response when ready.
        </div>
      )}

      {run.streamError && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-xs text-amber-800">
          {run.streamError}
        </div>
      )}

      {run.runError && (
        <div className="rounded-md border border-red-200 bg-red-50 px-2.5 py-2 text-xs text-red-700">
          {run.runError}
        </div>
      )}

      {steps.length > 0 && (
        <div className="space-y-1.5">
          {steps.map((step) => (
            <StepRow key={step.step_id} step={step} />
          ))}
        </div>
      )}

      <ThinkingPanel events={run.events} />

      {timeline.length > 0 && (
        <div className="space-y-1.5">
          {timeline.slice(-8).map((event) => (
            <EventRow key={event.event_id} event={event} />
          ))}
        </div>
      )}
    </div>
  )
}

function StepRow({ step }: { step: AgentRunStep }) {
  return (
    <div className="flex items-start gap-2 text-xs text-slate-600">
      {statusIcon(step.status)}
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium text-slate-700">{step.title}</div>
        {step.agent && <div className="truncate text-slate-500">{step.agent}</div>}
      </div>
    </div>
  )
}

function EventRow({ event }: { event: AgentRunEvent }) {
  const link = artifactLink(event)
  return (
    <div className={`flex items-start gap-2 text-xs ${event.status === 'failed' || event.kind === 'error' ? 'text-red-700' : 'text-slate-600'}`}>
      {event.kind === 'tool' ? <Wrench className="mt-0.5 h-3.5 w-3.5" /> : statusIcon(event.status || 'running')}
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{event.title || event.summary || event.kind}</div>
        {event.summary && event.summary !== event.title && (
          <div className="line-clamp-2 text-slate-500">{event.summary}</div>
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
      </div>
    </div>
  )
}

function statusLabel(status: string) {
  if (status === 'done') return 'Done'
  if (status === 'failed') return 'Failed'
  return 'Running'
}

function statusIcon(status: string) {
  if (status === 'done' || status === 'success') {
    return <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-emerald-600" />
  }
  if (status === 'failed') {
    return <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-red-600" />
  }
  if (status === 'running' || status === 'started') {
    return <Loader2 className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 animate-spin text-slate-500" />
  }
  return <Circle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-slate-400" />
}

function artifactLink(event: AgentRunEvent): string {
  const detail = event.detail || {}
  for (const key of ['doc_url', 'form_url', 'lecturer_doc_url', 'student_doc_url']) {
    const value = detail[key]
    if (typeof value === 'string' && value.startsWith('http')) return value
  }
  return ''
}
