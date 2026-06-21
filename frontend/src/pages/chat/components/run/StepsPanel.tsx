import { useMemo } from 'react'
import type { AgentRunEvent, AgentRunStep } from '../../../../services/agentRunStream'
import { StepTimelineRow } from './StepTimelineRow'

const STEP_EVENT_KINDS = new Set(['process', 'tool', 'retrieval', 'artifact', 'error'])

type Props = {
  steps: Record<string, AgentRunStep>
  events: AgentRunEvent[]
}

export function StepsPanel({ steps, events }: Props) {
  const rows = useMemo(() => {
    const stepRows = Object.values(steps)
      .sort((a, b) => (a.updated_at || 0) - (b.updated_at || 0))
      .map((step) => ({ type: 'step' as const, data: step, sortKey: step.updated_at || 0 }))

    const eventRows = events
      .filter((event) => STEP_EVENT_KINDS.has(event.kind))
      .sort(
        (a, b) =>
          (a.created_at || 0) - (b.created_at || 0) ||
          a.event_id.localeCompare(b.event_id),
      )
      .map((event) => ({ type: 'event' as const, data: event, sortKey: event.created_at || 0 }))

    return [...stepRows, ...eventRows].sort((a, b) => a.sortKey - b.sortKey)
  }, [steps, events])

  if (rows.length === 0) return null

  return (
    <div className="space-y-1.5">
      {rows.map((row) => (
        <StepTimelineRow
          key={row.type === 'step' ? `step-${row.data.step_id}` : `event-${row.data.event_id}`}
          item={row.type === 'step' ? { type: 'step', data: row.data } : { type: 'event', data: row.data }}
        />
      ))}
    </div>
  )
}
