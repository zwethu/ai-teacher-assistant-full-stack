import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Lightbulb, X } from 'lucide-react'
import { getCurrentCourseBlueprint } from '../../services/courseBlueprintService'

/**
 * Soft, non-blocking nudge shown on standalone generation pages when the selected
 * space has no active Course Blueprint. Generation works fine without a plan — this
 * just points lecturers to create one first for better week-to-week alignment.
 */
export function PlanHintBanner({ batchId }: { batchId: string | null | undefined }) {
  const [hasPlan, setHasPlan] = useState<boolean | null>(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    setDismissed(false)
    if (!batchId) {
      setHasPlan(null)
      return
    }
    let cancelled = false
    setHasPlan(null)
    getCurrentCourseBlueprint(batchId)
      .then((bp) => { if (!cancelled) setHasPlan(bp?.status === 'active') })
      .catch(() => { if (!cancelled) setHasPlan(true) }) // fail open — never nag on error
    return () => { cancelled = true }
  }, [batchId])

  if (!batchId || dismissed || hasPlan !== false) return null

  return (
    <div className="mb-4 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
      <Lightbulb className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-500" />
      <div className="flex-1 text-sm text-amber-800">
        No course plan yet for this space. You can generate now, but creating a{' '}
        <Link to="/batches" className="font-semibold underline hover:text-amber-900">
          Course Plan
        </Link>{' '}
        first (Batches → Plan tab) helps the agent align week-to-week for better results.
      </div>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        className="text-amber-400 hover:text-amber-600"
        aria-label="Dismiss"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}
