import { ChevronDown, ChevronRight, Loader2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { RunUiState } from '../../runTypes'
import { StepsPanel } from './StepsPanel'

type Props = {
  run?: RunUiState
  isFinal: boolean
}

const STEP_EVENT_KINDS = new Set(['process', 'tool', 'retrieval', 'artifact', 'error'])

export function RunDetails({ run, isFinal }: Props) {
  const status = run?.status || 'running'
  const stepCount = useMemo(() => {
    if (!run) return 0
    const stepsCount = Object.keys(run.steps).length
    const eventsCount = run.events.filter((event) => STEP_EVENT_KINDS.has(event.kind)).length
    return stepsCount + eventsCount
  }, [run])

  const defaultOpen = status === 'running'
  const [open, setOpen] = useState(defaultOpen)

  useEffect(() => {
    if (isFinal || status === 'done' || status === 'failed') {
      setOpen(false)
    } else if (status === 'running') {
      setOpen(true)
    }
  }, [isFinal, status])

  if (!run) return null

  const headerLabel =
    status === 'done'
      ? `Completed ${stepCount} steps`
      : status === 'failed'
        ? `Failed after ${stepCount} steps`
        : stepCount > 0
          ? `Running ${stepCount} steps`
          : 'Working...'

  const hasContent =
    stepCount > 0 ||
    run.streamError ||
    run.runError ||
    run.liveConnected === false ||
    status === 'running'

  if (!hasContent) return null

  return (
    <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50/70 p-3">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2 text-left text-xs font-semibold text-slate-700"
      >
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 flex-shrink-0 text-slate-500" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 flex-shrink-0 text-slate-500" />
        )}
        {status === 'running' && stepCount === 0 && (
          <Loader2 className="h-3.5 w-3.5 flex-shrink-0 animate-spin text-slate-500" />
        )}
        <span>{headerLabel}</span>
      </button>

      {open && (
        <div className="space-y-2">
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

          <StepsPanel steps={run.steps} events={run.events} />
        </div>
      )}
    </div>
  )
}
