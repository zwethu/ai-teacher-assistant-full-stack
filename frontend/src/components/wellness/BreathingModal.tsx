import { useEffect, useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { useStress } from '../../context/StressContext'
import {
  BREATHING_REDUCTION,
  completeBreathing,
  type BreathingResult,
} from '../../services/wellnessService'
import { Button } from '../../design-system'

const TOTAL_CYCLES = 3
const PHASES = [
  { key: 'inhale', label: 'Inhale slowly…', durationMs: 4000 },
  { key: 'hold', label: 'Hold…', durationMs: 4000 },
  { key: 'exhale', label: 'Exhale slowly…', durationMs: 4000 },
] as const

/* One guided session: 3 cycles of inhale / hold / exhale, then the server
   applies the daily −20.

   It can always be closed. There used to be a forced mode above 85 with no
   close button — an exercise you cannot leave is a lock with a candle drawn
   on it, and the person it trapped was someone already out of time. The offer
   is the whole intervention now. */
export default function BreathingModal() {
  const { breathingOpen, closeBreathing, applyState } = useStress()

  const [cycle, setCycle] = useState(0)
  const [phaseIndex, setPhaseIndex] = useState(0)
  const [finished, setFinished] = useState(false)
  const [result, setResult] = useState<BreathingResult | null>(null)
  const completingRef = useRef(false)

  /* Restart the session every time the modal opens. */
  useEffect(() => {
    if (!breathingOpen) return
    setCycle(0)
    setPhaseIndex(0)
    setFinished(false)
    setResult(null)
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
        <button
          type="button"
          onClick={closeBreathing}
          className="absolute top-4 right-4 p-1.5 rounded-full text-slate-400 hover:text-slate-600 hover:bg-white/70 transition-colors"
          aria-label="Close breathing exercise"
        >
          <X className="w-4 h-4" />
        </button>

        {!finished && (
          <>
            <h2 className="font-display text-lg font-bold text-slate-800 mb-1">
              Breathing exercise
            </h2>
            <p className="text-xs text-slate-500 mb-8">
              A short reset. Reduces stress by {BREATHING_REDUCTION} points, once per day.
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

            <Button variant="secondary" block onClick={closeBreathing}>
              Close
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
