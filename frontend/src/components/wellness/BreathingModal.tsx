import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { X } from 'lucide-react'
import { useStress } from '../../context/StressContext'
import {
  BREATHING_REDUCTION,
  completeBreathing,
  saveJournal,
  type BreathingResult,
} from '../../services/wellnessService'
import { Button } from '../../design-system'
import { TEXTAREA_CLASS } from '../ui/fieldStyles'

export const MOODS = [
  { value: 'great', emoji: '😊', label: 'Great' },
  { value: 'good', emoji: '🙂', label: 'Good' },
  { value: 'okay', emoji: '😐', label: 'Okay' },
  { value: 'difficult', emoji: '😟', label: 'Difficult' },
  { value: 'overwhelmed', emoji: '😫', label: 'Overwhelmed' },
] as const

const TOTAL_CYCLES = 3
const PHASES = [
  { key: 'inhale', label: 'Inhale slowly…', durationMs: 4000 },
  { key: 'hold', label: 'Hold…', durationMs: 4000 },
  { key: 'exhale', label: 'Exhale slowly…', durationMs: 4000 },
] as const

/* One guided session: 3 cycles of inhale / hold / exhale, then the server
   applies the daily −20 and (if not journaled yet) asks how you're feeling.
   In forced mode (score ≥ 85) there is no close button — completing the
   exercise is the way out. */
export default function BreathingModal() {
  const { breathingOpen, breathingForced, closeBreathing, applyState } =
    useStress()

  const [cycle, setCycle] = useState(0)
  const [phaseIndex, setPhaseIndex] = useState(0)
  const [finished, setFinished] = useState(false)
  const [result, setResult] = useState<BreathingResult | null>(null)
  const [mood, setMood] = useState('')
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [reflectionSaved, setReflectionSaved] = useState(false)
  const completingRef = useRef(false)

  /* Restart the session every time the modal opens. */
  useEffect(() => {
    if (!breathingOpen) return
    setCycle(0)
    setPhaseIndex(0)
    setFinished(false)
    setResult(null)
    setMood('')
    setNotes('')
    setReflectionSaved(false)
  }, [breathingOpen])

  /* Phase clock. */
  useEffect(() => {
    if (!breathingOpen || finished) return undefined
    const timeout = window.setTimeout(() => {
      if (phaseIndex < PHASES.length - 1) {
        setPhaseIndex(phaseIndex + 1)
        return
      }
      if (cycle < TOTAL_CYCLES - 1) {
        setCycle(cycle + 1)
        setPhaseIndex(0)
        return
      }
      setFinished(true)
    }, PHASES[phaseIndex].durationMs)
    return () => window.clearTimeout(timeout)
  }, [breathingOpen, finished, cycle, phaseIndex])

  /* All cycles done → log it server-side (−20 once per day). */
  useEffect(() => {
    if (!finished || result || completingRef.current) return
    completingRef.current = true
    completeBreathing()
      .then((res) => {
        setResult(res)
        applyState(res)
      })
      .catch((err) => console.error('Breathing completion failed:', err))
      .finally(() => {
        completingRef.current = false
      })
  }, [finished, result, applyState])

  const phase = PHASES[phaseIndex]
  const circleScale = useMemo(() => {
    if (finished) return 1
    return phase.key === 'exhale' ? 1 : phase.key === 'inhale' ? 1.35 : 1.35
  }, [finished, phase.key])

  if (!breathingOpen) return null

  const showReflection =
    result?.stress_reduced && result.prompt_reflection && !reflectionSaved

  async function handleSaveReflection(e: FormEvent) {
    e.preventDefault()
    if (!mood) return
    setSubmitting(true)
    try {
      const saved = await saveJournal(mood, notes.trim())
      if (saved.ok) setReflectionSaved(true)
    } catch (err) {
      console.error('Failed to save reflection:', err)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      data-stress-ui
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Breathing exercise"
    >
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" />

      <div className="maia-glass-strong relative w-full max-w-md rounded-[28px] p-8 text-center shadow-2xl">
        {!breathingForced && (
          <button
            type="button"
            onClick={closeBreathing}
            className="absolute top-4 right-4 p-1.5 rounded-full text-slate-400 hover:text-slate-600 hover:bg-white/70 transition-colors"
            aria-label="Close breathing exercise"
          >
            <X className="w-4 h-4" />
          </button>
        )}

        {!finished && (
          <>
            <h2 className="font-display text-lg font-bold text-slate-800 mb-1">
              {breathingForced ? 'Recovery breathing' : 'Breathing exercise'}
            </h2>
            <p className="text-xs text-slate-500 mb-8">
              {breathingForced
                ? 'Your stress is very high. Complete all 3 cycles to lower it and continue.'
                : `A short reset. Reduces stress by ${BREATHING_REDUCTION} points, once per day.`}
            </p>

            <div className="flex items-center justify-center mb-8" aria-hidden="true">
              <div className="relative flex h-40 w-40 items-center justify-center">
                <div className="absolute inset-0 rounded-full border-2 border-[var(--violet-200)]" />
                <div
                  className="h-24 w-24 rounded-full bg-gradient-to-b from-[var(--violet-500)] to-[var(--violet-700)] shadow-lg shadow-violet-300/60"
                  style={{
                    transform: `scale(${circleScale})`,
                    transition: `transform ${phase.durationMs}ms ease-in-out`,
                  }}
                />
              </div>
            </div>

            <p className="text-sm font-semibold text-violet-800" aria-live="polite">
              {phase.label}
            </p>
            <p className="text-xs text-slate-400 mt-1 mb-5">
              Cycle {cycle + 1} of {TOTAL_CYCLES}
            </p>

            <div className="flex justify-center gap-2">
              {Array.from({ length: TOTAL_CYCLES }, (_, i) => (
                <span
                  key={i}
                  className={`h-2 w-2 rounded-full transition-colors ${
                    i < cycle ? 'bg-[var(--violet-600)]' : i === cycle ? 'bg-[var(--violet-400)]' : 'bg-slate-200'
                  }`}
                />
              ))}
            </div>
          </>
        )}

        {finished && !result && (
          <p className="py-16 text-sm text-slate-500">Logging your session…</p>
        )}

        {result && (
          <div className="space-y-4">
            <h2 className="font-display text-lg font-bold text-slate-800">
              Well done
            </h2>
            <p className="text-sm text-slate-600">{result.message}</p>

            {showReflection && (
              <form onSubmit={handleSaveReflection} className="space-y-3 text-left border-t border-slate-200/70 pt-4">
                <p className="text-xs font-semibold text-slate-600">
                  How are you feeling?
                </p>
                <div className="flex flex-wrap gap-2">
                  {MOODS.map((m) => (
                    <button
                      key={m.value}
                      type="button"
                      onClick={() => setMood(m.value)}
                      className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs border transition-colors ${
                        mood === m.value
                          ? 'border-violet-400 bg-violet-50 text-violet-800'
                          : 'border-slate-200 bg-white/70 hover:border-violet-300 hover:bg-violet-50/60'
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
                  className={TEXTAREA_CLASS}
                />
                <Button type="submit" disabled={!mood || submitting} block>
                  {submitting ? 'Saving…' : 'Save reflection'}
                </Button>
              </form>
            )}

            {reflectionSaved && (
              <p className="text-xs font-medium text-violet-700">
                Reflection saved to your journal.
              </p>
            )}

            {(!showReflection || reflectionSaved) && (
              <Button variant="secondary" block onClick={closeBreathing}>
                Close
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
