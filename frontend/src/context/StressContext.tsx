/* Stress controller — one owner for the stress meter's client half.
   The server is the source of truth; this context keeps a synced copy, reports
   rapid clicking, and owns which wellness dialog is open.

   What it deliberately no longer does: block anything. There is no forced
   modal and no blocked state, because a lecturer whose deadline is tomorrow
   is going to work tonight either way — the meter's job is to tell them what
   it is costing, and to keep the breathing exercise one click away. */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  RAPID_CLICK_STRESS,
  getStress,
  increaseStress,
  type StressState,
} from '../services/wellnessService'
import { useAuth } from '../hooks/useAuth'

const SYNC_INTERVAL_MS = 5 * 60 * 1000
/* 7 clicks in a row, each within 700ms of the last, reads as frustration. */
const RAPID_CLICK_WINDOW_MS = 700
const RAPID_CLICK_COUNT = 7

interface StressContextValue {
  stress: StressState | null
  refresh: () => Promise<void>
  applyState: (state: StressState) => void
  /** The hub: current level, breathing, and the journal. */
  wellnessOpen: boolean
  openWellness: () => void
  closeWellness: () => void
  breathingOpen: boolean
  openBreathing: () => void
  closeBreathing: () => void
}

const StressContext = createContext<StressContextValue | null>(null)

export function useStress(): StressContextValue {
  const ctx = useContext(StressContext)
  if (!ctx) throw new Error('useStress must be used within StressProvider')
  return ctx
}

export function StressProvider({ children }: { children: ReactNode }) {
  const { user, isLecturer } = useAuth()
  const enabled = Boolean(user && isLecturer)

  const [stress, setStress] = useState<StressState | null>(null)
  const [wellnessOpen, setWellnessOpen] = useState(false)
  const [breathingOpen, setBreathingOpen] = useState(false)

  const applyState = useCallback((state: StressState) => {
    setStress(state)
  }, [])

  const refresh = useCallback(async () => {
    if (!enabled) return
    try {
      setStress(await getStress())
    } catch (err) {
      console.error('Failed to sync stress state:', err)
    }
  }, [enabled])

  /* Initial load + periodic sync (decay happens server-side over time). */
  useEffect(() => {
    if (!enabled) return undefined
    refresh()
    const id = window.setInterval(refresh, SYNC_INTERVAL_MS)
    return () => window.clearInterval(id)
  }, [enabled, refresh])

  /* Rapid clicking. Clicks on the wellness UI itself never count — punishing
     someone for opening the breathing exercise would defeat the point. */
  const clickCountRef = useRef(0)
  const lastClickRef = useRef(0)
  const reportingRef = useRef(false)
  useEffect(() => {
    if (!enabled) return undefined
    function onClick(e: MouseEvent) {
      const target = e.target as Element | null
      if (target?.closest('[data-stress-ui]')) return
      const now = Date.now()
      clickCountRef.current =
        now - lastClickRef.current < RAPID_CLICK_WINDOW_MS
          ? clickCountRef.current + 1
          : 1
      lastClickRef.current = now
      if (clickCountRef.current >= RAPID_CLICK_COUNT && !reportingRef.current) {
        clickCountRef.current = 0
        reportingRef.current = true
        increaseStress(RAPID_CLICK_STRESS)
          .then(setStress)
          .catch((err) => console.error('Failed to report rapid clicks:', err))
          .finally(() => {
            reportingRef.current = false
          })
      }
    }
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [enabled])

  const openWellness = useCallback(() => setWellnessOpen(true), [])
  const closeWellness = useCallback(() => setWellnessOpen(false), [])
  /* Breathing replaces the hub rather than stacking on it: two dialogs deep,
     the close button stops meaning anything predictable. */
  const openBreathing = useCallback(() => {
    setWellnessOpen(false)
    setBreathingOpen(true)
  }, [])
  const closeBreathing = useCallback(() => setBreathingOpen(false), [])

  return (
    <StressContext.Provider
      value={{
        stress,
        refresh,
        applyState,
        wellnessOpen,
        openWellness,
        closeWellness,
        breathingOpen,
        openBreathing,
        closeBreathing,
      }}
    >
      {children}
    </StressContext.Provider>
  )
}
