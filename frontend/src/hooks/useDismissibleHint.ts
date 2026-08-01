import { useCallback, useState } from 'react'

const STORAGE_PREFIX = 'mila.hint.'

/**
 * A hint that teaches once and then stays gone.
 *
 * For copy that is genuinely useful the first time and pure furniture every
 * time after — "generation keeps running if you leave this page" is true, worth
 * saying, and worth saying exactly once. Repeating it on every run trains people
 * to look past that part of the card, which is the opposite of what a notice is
 * for.
 *
 * Dismissal persists across sessions and devices-per-browser, which is the
 * right granularity: it is a fact about how the product works, not per-batch
 * state worth syncing.
 */
export function useDismissibleHint(key: string): { visible: boolean; dismiss: () => void } {
  const [dismissed, setDismissed] = useState(() => {
    // Private-mode Safari throws on access rather than returning null, and a
    // hint is never worth breaking a page over.
    try {
      return window.localStorage.getItem(STORAGE_PREFIX + key) === '1'
    } catch {
      return false
    }
  })

  const dismiss = useCallback(() => {
    setDismissed(true)
    try {
      window.localStorage.setItem(STORAGE_PREFIX + key, '1')
    } catch {
      // Shown again next session, which is a better failure than not dismissing.
    }
  }, [key])

  return { visible: !dismissed, dismiss }
}
