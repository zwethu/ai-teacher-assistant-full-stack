import { ChevronDown } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { RunUiState } from '../../runTypes'
import { normalizeRunRows } from './normalizeRunRows'
import { formatDuration, runDurationSeconds, runSummaryLabel } from './runDuration'
import { StepsPanel } from './StepsPanel'
import { useSettlingRows } from './useSettlingRows'

type Props = {
  run?: RunUiState
  isFinal: boolean
}

/**
 * The agent's steps, in two quite different modes.
 *
 * While the run is live this shows only what is happening *now* — one row for
 * sequential work, several when the agent fans out tool calls in parallel — and
 * a row leaves as soon as it settles. Nothing is lost: every step stays in
 * `run.steps` / `run.events`, it is only the view that is narrowed. There is no
 * toggle in this mode, because a run whose visible rows are already the live
 * ones has nothing to collapse.
 *
 * Once the run finishes, the full stored list becomes available behind the
 * "Completed N steps" toggle, collapsed by default.
 */
export function RunDetails({ run, isFinal }: Props) {
  const status = run?.status || 'running'
  const rows = useMemo(
    () => (run ? normalizeRunRows(run.steps, run.events, status) : []),
    [run, status],
  )
  const isRunning = status === 'running' && !isFinal
  // Everything in flight, plus whatever just finished — a step dropped on the
  // frame its status flips never gets to show the "Done" it earned.
  const liveRows = useSettlingRows(rows)
  const [open, setOpen] = useState(false)

  // Re-collapse whenever a run goes live again (a retry on the same row).
  useEffect(() => {
    if (isRunning) setOpen(false)
  }, [isRunning])

  if (!run) return null

  // A stalled stream is only worth mentioning when the silence is visible.
  // Steps arriving on screen already say the run is alive, and the fallback
  // polling the warning describes happens either way — so with rows streaming
  // it is a warning about nothing, laid over the evidence contradicting it.
  const showStallNotice = liveRows.length === 0
  const stallNotice = run.streamError || (run.liveConnected === false
    ? 'Live updates disconnected. I will fetch the final response when ready.'
    : '')

  // Banners sit outside the collapsible: during a run there is nothing to open,
  // and after one they are the last thing that should need a click to find.
  const banners: ReactNode = (
    <>
      {showStallNotice && stallNotice && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-xs text-amber-800">
          {stallNotice}
        </div>
      )}
      {run.runError && (
        <div className="rounded-md border border-red-200 bg-red-50 px-2.5 py-2 text-xs text-red-700">
          {run.runError}
        </div>
      )}
    </>
  )

  const hasBanner = Boolean(run.runError) || (showStallNotice && Boolean(stallNotice))

  if (isRunning) {
    // No header. The rows name themselves, and the thinking line directly below
    // already carries the "still working" signal — a count above steps that
    // disappear as they finish would only invite reading it as a total.
    if (liveRows.length === 0 && !hasBanner) return null
    return (
      <div className="space-y-2">
        {banners}
        <StepsPanel rows={liveRows} live />
      </div>
    )
  }

  const stepCount = rows.length
  // One line for the whole run. The thinking panel used to carry its own
  // "Thought for 36s" here, spanning nearly the same interval — two clocks for
  // one piece of work, which invites reading a difference into them.
  const headerLabel = runSummaryLabel(
    status,
    stepCount,
    formatDuration(runDurationSeconds(run.events, run.steps)),
  )

  if (stepCount === 0 && !hasBanner) return null

  return (
    <div className="space-y-2">
      {banners}

      {stepCount > 0 && (
        <>
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            className="group -mx-1.5 inline-flex items-center gap-2 rounded-md px-1.5 py-1 text-left text-xs font-semibold text-slate-700 transition-colors hover:bg-violet-50/70 hover:text-violet-800"
          >
            <span>{headerLabel}</span>
            {/* Hidden until hover. It still occupies its box, so revealing it
                causes no layout shift; the row's violet tint is the other half
                of the hover cue. Also revealed on keyboard focus. */}
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
              <StepsPanel rows={rows} />
            </div>
          </div>
        </>
      )}
    </div>
  )
}
