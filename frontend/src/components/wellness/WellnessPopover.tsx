import { useEffect, useState } from 'react'
import { Wind } from 'lucide-react'
import { useStress } from '../../context/StressContext'
import {
  BREATHING_REDUCTION,
  getJournal,
  type JournalEntry,
} from '../../services/wellnessService'
import { MOODS } from './BreathingModal'
import { formatDate } from '../../utils/formatDate'

const MOOD_META: Record<string, { emoji: string; label: string }> =
  Object.fromEntries(MOODS.map((m) => [m.value, { emoji: m.emoji, label: m.label }]))

/* The wellness panel embedded under the sidebar stress meter: current level,
   the breathing exercise entry point, and the private reflection journal.
   The breathing session itself runs in the shared BreathingModal. */
export default function WellnessPopover() {
  const { stress, openBreathing, breathingOpen } = useStress()
  const [journal, setJournal] = useState<JournalEntry[]>([])
  const [loading, setLoading] = useState(true)

  /* Reload the journal when the panel mounts and after a breathing session
     closes (a reflection may just have been saved). */
  useEffect(() => {
    if (breathingOpen) return undefined
    let cancelled = false
    setLoading(true)
    getJournal()
      .then((entries) => {
        if (!cancelled) setJournal(entries)
      })
      .catch((err) => console.error('Failed to load wellness journal:', err))
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [breathingOpen])

  return (
    <div data-stress-ui className="space-y-4">
      {stress?.warning && (
        <p className="text-xs text-orange-700">
          Your stress is high. Take a break before it reaches 100.
        </p>
      )}
      {stress?.blocked && (
        <p className="text-xs text-red-700 font-medium">
          Max stress — features are paused until it drops below 100.
        </p>
      )}

      <div>
        {stress?.breathing_used_today ? (
          <button
            type="button"
            onClick={openBreathing}
            className="w-full text-sm text-violet-700 font-medium py-2 rounded-xl hover:bg-violet-50/70 transition-colors"
          >
            Breathing done today — breathe again anytime
          </button>
        ) : (
          <button
            type="button"
            onClick={openBreathing}
            className="w-full inline-flex items-center justify-center gap-2 text-sm font-semibold text-white bg-[var(--violet-600)] hover:bg-[var(--violet-700)] rounded-xl py-2.5 transition-colors"
          >
            <Wind className="w-4 h-4" aria-hidden="true" />
            Start breathing exercise
          </button>
        )}
        <p className="text-[11px] text-slate-400 text-center mt-1.5">
          ~40 seconds · reduces stress by {BREATHING_REDUCTION} points, once per day
        </p>
      </div>

      <div className="border-t border-slate-100 pt-3">
        <p className="text-xs font-semibold text-slate-500 mb-2">
          Wellness journal
        </p>
        {loading ? (
          <p className="text-xs text-slate-400">Loading…</p>
        ) : journal.length === 0 ? (
          <p className="text-xs text-slate-400">
            Reflections you save after breathing land here.
          </p>
        ) : (
          <ul className="space-y-1.5 max-h-44 overflow-y-auto pr-1">
            {journal.map((entry) => (
              <li
                key={entry.id}
                className="flex items-center justify-between gap-2 text-xs text-slate-600"
                title={entry.notes || undefined}
              >
                <span className="truncate">
                  {MOOD_META[entry.mood]?.emoji ?? '📝'}{' '}
                  {MOOD_META[entry.mood]?.label ?? entry.mood}
                  {entry.notes ? (
                    <span className="text-slate-400"> · {entry.notes}</span>
                  ) : null}
                </span>
                <span className="shrink-0 text-slate-400">
                  {formatDate(entry.created_at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
