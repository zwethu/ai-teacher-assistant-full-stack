import { useEffect, useState, type FormEvent } from 'react'
import { X } from 'lucide-react'
import type { Timestamp } from 'firebase/firestore'
import {
  completeBreathing,
  getJournal,
  getStress,
  saveJournal,
  type JournalEntry,
  type StressState,
} from '../../services/wellnessService'
import { formatDate } from '../../utils/formatDate'
import { Button } from '../../design-system'

const MOODS = [
  { value: 'great', emoji: '😊', label: 'Great' },
  { value: 'good', emoji: '🙂', label: 'Good' },
  { value: 'okay', emoji: '😐', label: 'Okay' },
  { value: 'difficult', emoji: '😟', label: 'Difficult' },
  { value: 'overwhelmed', emoji: '😫', label: 'Overwhelmed' },
] as const

const MOOD_EMOJI: Record<string, string> = Object.fromEntries(
  MOODS.map((m) => [m.value, m.emoji]),
)

const BREATHING_PHASES = [
  { text: 'Inhale...', durationMs: 4000 },
  { text: 'Hold...', durationMs: 4000 },
  { text: 'Exhale...', durationMs: 4000 },
]

interface WellnessPopoverProps {
  uid: string
  onClose?: () => void
  embedded?: boolean
  onStressUpdate?: () => void
}

function stressLabel(score: number): string {
  if (score >= 100) return 'Max'
  if (score >= 80) return 'High'
  return 'Low'
}

function stressBarColor(score: number): string {
  if (score >= 100) return 'bg-red-500'
  if (score >= 80) return 'bg-orange-500'
  return 'bg-violet-500'
}

function stressLabelColor(score: number): string {
  if (score >= 100) return 'text-red-600'
  if (score >= 80) return 'text-orange-600'
  return 'text-violet-600'
}

export default function WellnessPopover({
  uid,
  onClose,
  embedded = false,
  onStressUpdate,
}: WellnessPopoverProps) {
  const [loading, setLoading] = useState(true)
  const [stress, setStress] = useState<StressState | null>(null)
  const [journal, setJournal] = useState<JournalEntry[]>([])
  const [breathing, setBreathing] = useState(false)
  const [breathPhase, setBreathPhase] = useState('')
  const [breathResult, setBreathResult] = useState<{
    stress_reduced: boolean
    prompt_reflection: boolean
  } | null>(null)
  const [mood, setMood] = useState('')
  const [notes, setNotes] = useState('')
  const [reflectionSaved, setReflectionSaved] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const [stressData, journalData] = await Promise.all([
          getStress(uid),
          getJournal(uid),
        ])
        if (!cancelled) {
          setStress(stressData)
          setJournal(journalData)
        }
      } catch (err) {
        console.error('Failed to load wellness data:', err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [uid])

  useEffect(() => {
    if (!breathing) return undefined

    let phaseIndex = 0
    let timeoutId: number

    const runPhase = () => {
      if (phaseIndex >= BREATHING_PHASES.length) {
        setBreathing(false)
        setBreathPhase('')
        completeBreathing(uid)
          .then((result) => {
            setStress(result)
            setBreathResult({
              stress_reduced: result.stress_reduced,
              prompt_reflection: result.prompt_reflection,
            })
            onStressUpdate?.()
            return getJournal(uid)
          })
          .then(setJournal)
          .catch((err) => console.error('Breathing completion failed:', err))
        return
      }
      setBreathPhase(BREATHING_PHASES[phaseIndex].text)
      timeoutId = window.setTimeout(() => {
        phaseIndex += 1
        runPhase()
      }, BREATHING_PHASES[phaseIndex].durationMs)
    }

    runPhase()
    return () => window.clearTimeout(timeoutId)
  }, [breathing, uid])

  async function handleSubmitReflection(e: FormEvent) {
    e.preventDefault()
    if (!mood || !stress) return
    setSubmitting(true)
    try {
      const result = await saveJournal(uid, mood, notes.trim(), stress.stress_score)
      if (result.ok) {
        setReflectionSaved(true)
        const updated = await getStress(uid)
        setStress(updated)
        onStressUpdate?.()
        const entries = await getJournal(uid)
        setJournal(entries)
      }
    } catch (err) {
      console.error('Failed to save journal:', err)
    } finally {
      setSubmitting(false)
    }
  }

  const score = stress?.stress_score ?? 0
  const showReflection =
    breathResult?.prompt_reflection &&
    !stress?.journaled_today &&
    !reflectionSaved

  const panelContent = loading ? (
    <p className="text-sm text-slate-500">Loading…</p>
  ) : (
    <div className="space-y-4">
      {!embedded && (
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-semibold text-slate-500">Stress Level</span>
            <span className={`text-xs font-bold ${stressLabelColor(score)}`}>
              {stressLabel(score)}
            </span>
          </div>
          <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-700 ${stressBarColor(score)}`}
              style={{ width: `${score}%` }}
            />
          </div>
          {score >= 80 && score < 100 && (
            <p className="text-xs text-orange-700 mt-2">
              ⚠️ Your stress is high. Take a break!
            </p>
          )}
          {score >= 100 && (
            <p className="text-xs text-red-700 mt-2">
              🔴 Max stress! Do a breathing exercise first.
            </p>
          )}
        </div>
      )}

      {embedded && score >= 80 && score < 100 && (
        <p className="text-xs text-orange-700">
          ⚠️ Your stress is high. Take a break!
        </p>
      )}
      {embedded && score >= 100 && (
        <p className="text-xs text-red-700">
          🔴 Max stress! Do a breathing exercise first.
        </p>
      )}

      <div className={embedded ? '' : 'border-t border-slate-100 pt-4'}>
            {breathing ? (
              <p className="text-xl font-semibold text-center text-violet-700 py-6">
                {breathPhase}
              </p>
            ) : (
              <>
                {stress?.breathing_used_today ? (
                  <button
                    type="button"
                    onClick={() => {
                      setBreathResult(null)
                      setBreathing(true)
                    }}
                    className="w-full text-sm text-violet-700 font-medium py-2"
                  >
                    ✅ Breathing done today
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setBreathResult(null)
                      setBreathing(true)
                    }}
                    className="w-full text-sm font-semibold text-white bg-violet-600 hover:bg-violet-700 rounded-xl py-2.5 transition-colors"
                  >
                    🧘 Start Breathing Exercise
                  </button>
                )}
              </>
            )}

            {breathResult && !breathing && (
              <div className="mt-3 space-y-1">
                {breathResult.stress_reduced ? (
                  <p className="text-xs text-violet-700 font-medium">
                    ✅ Stress reduced by 20 points!
                  </p>
                ) : (
                  <p className="text-xs text-slate-500">
                    You&apos;ve already had your reduction today
                  </p>
                )}
              </div>
            )}
          </div>

          {showReflection && (
            <form onSubmit={handleSubmitReflection} className="border-t border-slate-100 pt-4 space-y-3">
              <p className="text-xs font-semibold text-slate-600">How are you feeling?</p>
              <div className="flex flex-wrap gap-2">
                {MOODS.map((m) => (
                  <button
                    key={m.value}
                    type="button"
                    onClick={() => setMood(m.value)}
                    className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs border transition-colors ${
                      mood === m.value
                        ? 'border-violet-400 bg-violet-50 text-violet-800'
                        : 'border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <span>{m.emoji}</span>
                    <span>{m.label}</span>
                  </button>
                ))}
              </div>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Optional notes…"
                rows={2}
                className="block w-full rounded-lg border border-slate-300 shadow-sm py-2 px-3 text-sm focus:border-violet-500 focus:ring-violet-500 resize-y"
              />
              <Button type="submit" disabled={!mood || submitting} block>
                Save reflection
              </Button>
            </form>
          )}

          {reflectionSaved && (
            <p className="text-xs text-emerald-700 font-medium">✅ Reflection saved!</p>
          )}

          {journal.length > 0 && (
            <div className="border-t border-slate-100 pt-4">
              <p className="text-xs font-semibold text-slate-500 mb-2">Recent entries</p>
              <ul className="space-y-1.5">
                {journal.slice(0, 3).map((entry) => (
                  <li
                    key={entry.id}
                    className="flex items-center justify-between text-xs text-slate-600"
                  >
                    <span>
                      {MOOD_EMOJI[entry.mood] ?? '📝'}{' '}
                      {MOODS.find((m) => m.value === entry.mood)?.label ?? entry.mood}
                    </span>
                    <span className="text-slate-400">
                      {formatDate(entry.created_at as Timestamp)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
    </div>
  )

  if (embedded) {
    return panelContent
  }

  return (
    <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 p-5 w-80">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-bold text-slate-800">Wellness</h3>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
      {panelContent}
    </div>
  )
}
