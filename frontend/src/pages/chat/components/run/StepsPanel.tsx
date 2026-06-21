import { useMemo } from 'react'
import type { AgentRunEvent, AgentRunStep } from '../../../../services/agentRunStream'
import { normalizeRunRows } from './normalizeRunRows'
import { StepTimelineRow } from './StepTimelineRow'

type Props = {
  steps: Record<string, AgentRunStep>
  events: AgentRunEvent[]
}

export function StepsPanel({ steps, events }: Props) {
  const rows = useMemo(() => normalizeRunRows(steps, events), [steps, events])

  if (rows.length === 0) return null

  return (
    <div className="space-y-1.5">
      {rows.map((row) => (
        <StepTimelineRow key={row.id} row={row} />
      ))}
    </div>
  )
}
