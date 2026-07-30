import { ChevronDown } from 'lucide-react'
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
    return normalizeRunRows(run.steps, run.events, status).length
  }, [run])

  const [open, setOpen] = useState(status === 'running')

  useEffect(() => {
    if (isFinal || status === 'done' || status === 'failed' || status === 'cancelled') {
      setOpen(false)
    } else if (status === 'running') {
      setOpen(true)
    }
  }, [isFinal, status])

  if (!run) return null

  const headerLabel =
    status === 'done'
      ? `Completed ${stepCount} steps`
      : status === 'cancelled'
        ? 'Request cancelled'
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
    <div className="space-y-2">
      {/* No spinner: while the run is active the label itself animates, which
          keeps the row to a single moving element (MILA motion is "quiet"). */}
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="group -mx-1.5 inline-flex items-center gap-2 rounded-md px-1.5 py-1 text-left text-xs font-semibold text-slate-700 transition-colors hover:bg-violet-50/70 hover:text-violet-800"
      >
        <span className={status === 'running' ? 'mila-live-text' : undefined}>
          {headerLabel}
        </span>
        {/* Hidden until hover. It still occupies its box, so revealing it
            causes no layout shift; the row's violet tint is the other half of
            the hover cue. Also revealed on keyboard focus. */}
        <ChevronDown
          className={`h-3.5 w-3.5 flex-shrink-0 text-violet-600 opacity-0 transition-all duration-200 group-hover:opacity-100 group-focus-visible:opacity-100 ${
            open ? 'rotate-0' : '-rotate-90'
          }`}
        />
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

            <StepsPanel steps={run.steps} events={run.events} runStatus={status} />
          </div>
        </div>
      </div>
    </div>
  )
}
