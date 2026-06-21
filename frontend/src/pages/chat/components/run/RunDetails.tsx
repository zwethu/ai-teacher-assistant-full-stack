import { ChevronDown, Loader2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { RunUiState } from '../../runTypes'
import { normalizeRunRows } from './normalizeRunRows'
import { StepsPanel } from './StepsPanel'

type Props = {
  run?: RunUiState
  isFinal: boolean
}

export function RunDetails({ run, isFinal }: Props) {
  const status = run?.status || 'running'
  const stepCount = useMemo(() => {
    if (!run) return 0
    return normalizeRunRows(run.steps, run.events).length
  }, [run])

  const defaultOpen = status === 'running'
  const [open, setOpen] = useState(defaultOpen)

  useEffect(() => {
    if (run?.responseStarted || isFinal || status === 'done' || status === 'failed') {
      setOpen(false)
    } else if (status === 'running') {
      setOpen(true)
    }
  }, [isFinal, run?.responseStarted, status])

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
    <div className="space-y-2 pl-3 border-l-2 border-slate-200/70">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2 text-left text-xs font-semibold text-slate-700"
      >
        <ChevronDown
          className={`h-3.5 w-3.5 flex-shrink-0 text-slate-500 transition-transform duration-200 ${
            open ? 'rotate-0' : '-rotate-90'
          }`}
        />
        {status === 'running' && stepCount === 0 && (
          <Loader2 className="h-3.5 w-3.5 flex-shrink-0 animate-spin text-slate-500" />
        )}
        <span>{headerLabel}</span>
      </button>

      <div
        className="grid transition-all duration-200 ease-in-out"
        style={{ gridTemplateRows: open ? '1fr' : '0fr' }}
      >
        <div className="overflow-hidden">
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
        </div>
      </div>
    </div>
  )
}
