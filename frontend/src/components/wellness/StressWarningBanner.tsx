import { useEffect, useState } from 'react'
import { TriangleAlert, X } from 'lucide-react'
import { useStress } from '../../context/StressContext'
import { Button } from '../../design-system'

/* Shown while stress sits in the 80–99 warning band. Dismissible; the
   dismissal resets once the score falls back under the threshold, so the
   next climb warns again. */
export default function StressWarningBanner() {
  const { stress, openBreathing } = useStress()
  const [dismissed, setDismissed] = useState(false)

  const warning = Boolean(stress?.warning && !stress?.blocked)

  useEffect(() => {
    if (!warning) setDismissed(false)
  }, [warning])

  if (!warning || dismissed || !stress) return null

  return (
    <div
      data-stress-ui
      role="status"
      className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-amber-50/90 px-4 py-3 shadow-sm"
    >
      <TriangleAlert className="h-5 w-5 shrink-0 text-amber-600" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-amber-900">
          Your stress level is high ({Math.round(stress.stress_score)}/100)
        </p>
        <p className="text-xs text-amber-800/80">
          At 100 the assistant pauses. A breathing exercise takes one minute
          and lowers it by 20 points.
        </p>
      </div>
      <div className="flex items-center gap-1.5">
        <Button size="sm" onClick={openBreathing}>
          Breathe now
        </Button>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="p-1.5 rounded-md text-amber-700/70 hover:text-amber-900 hover:bg-amber-100 transition-colors"
          aria-label="Dismiss stress warning"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
