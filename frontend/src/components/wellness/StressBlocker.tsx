import { HeartPulse } from 'lucide-react'
import { useStress } from '../../context/StressContext'
import { Button } from '../../design-system'

/* Full overlay across the main content (never the sidebar — the wellness
   widget must stay reachable) while stress is pinned at 100. Features are
   also refused server-side, so this is honest UI, not the only lock. */
export default function StressBlocker() {
  const { stress, openBreathing } = useStress()

  if (!stress?.blocked) return null

  return (
    <div
      data-stress-ui
      className="absolute inset-0 z-40 flex items-center justify-center bg-white/60 backdrop-blur-md p-6"
      role="alert"
    >
      <div className="maia-glass-strong w-full max-w-md rounded-[28px] p-8 text-center shadow-2xl">
        <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-50">
          <HeartPulse className="h-6 w-6 text-red-500" aria-hidden="true" />
        </span>
        <h2 className="font-display text-lg font-bold text-slate-800 mb-2">
          Your stress is at maximum
        </h2>
        <p className="text-sm text-slate-600 mb-1">
          MILA has paused your features until your stress drops below 100.
        </p>
        <p className="text-xs text-slate-400 mb-6">
          {stress.breathing_used_today
            ? 'Today’s breathing reduction is used — stress eases by 5 points for every hour you step away.'
            : 'Complete a breathing exercise (−20) or take a break — stress eases by 5 points per hour away.'}
        </p>
        {!stress.breathing_used_today && (
          <Button block onClick={openBreathing}>
            Start breathing exercise
          </Button>
        )}
      </div>
    </div>
  )
}
