import { useEffect, useState } from 'react'

import { PRESENCE_EXIT_MS } from './usePresenceList'

/**
 * Keeps something mounted for the length of its exit animation after it stops
 * being wanted, so it can leave rather than vanish.
 *
 * The single-item counterpart to `usePresenceList`. Returns
 * `active || stillLeaving` — the `active ||` matters on the frame where it has
 * just been switched back on, before the effect has run.
 */
export function useExitDelay(active: boolean, exitMs: number = PRESENCE_EXIT_MS): boolean {
  const [mounted, setMounted] = useState(active)

  useEffect(() => {
    if (active) {
      setMounted(true)
      return undefined
    }
    const timer = setTimeout(() => setMounted(false), exitMs)
    return () => clearTimeout(timer)
  }, [active, exitMs])

  return active || mounted
}
