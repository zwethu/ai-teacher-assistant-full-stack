import { useEffect, useRef, useState } from 'react'

export type PresenceEntry<T> = { key: string; item: T; leaving: boolean }

/** Default exit window, matching the composer's leave animations. */
export const PRESENCE_EXIT_MS = 200

/**
 * Returns the caller's items plus, in the positions they used to hold, the ones
 * that have just gone — flagged so the caller can animate them out before they
 * are dropped.
 *
 * This is what makes removing something the reverse of adding it. React
 * unmounts a removed list item on the same tick, which is a pop; holding the
 * item for one exit animation is the only way to give it a way out. It watches
 * the list rather than the gesture, so it covers every route out — a remove
 * button, a send clearing the whole strip, or an agent step reaching `done`.
 */
export function usePresenceList<T>(
  items: T[],
  keyOf: (item: T) => string,
  exitMs: number = PRESENCE_EXIT_MS,
): PresenceEntry<T>[] {
  const live = items.map((item, index) => ({ key: keyOf(item), item, index }))
  // Keys, not the items themselves: an attachment whose upload status changes
  // is not an arrival or a departure, and re-running this for it would restart
  // the exit timer of something unrelated that is genuinely on its way out.
  const signature = live.map((entry) => entry.key).join(' ')
  const previous = useRef(live)
  const [leaving, setLeaving] = useState<{ key: string; item: T; index: number }[]>([])

  useEffect(() => {
    const present = new Set(live.map((entry) => entry.key))
    const gone = previous.current.filter((entry) => !present.has(entry.key))
    previous.current = live
    if (gone.length === 0) return
    setLeaving((current) => [
      ...current.filter((entry) => !gone.some((item) => item.key === entry.key)),
      ...gone,
    ])
    // `live` is derived from the signature this effect keys on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature])

  // Keeps the remembered items current when only their *contents* changed.
  // Declared after the effect above, so on a render where the keys changed it
  // runs second and writes the same value. Without it an item that changed
  // state while present — an agent step reaching "done" — would leave as a
  // ghost of whatever it looked like the last time the list gained or lost a
  // member, flickering back to a stale label on its way out.
  useEffect(() => {
    previous.current = live
  })

  // One timer for the whole set rather than one per departure. A second
  // removal mid-exit restarts it, which at worst leaves an already-invisible
  // ghost in the DOM a little longer — the animation's `both` fill holds it at
  // opacity 0, so nothing shows.
  useEffect(() => {
    if (leaving.length === 0) return undefined
    const timer = setTimeout(() => setLeaving([]), exitMs)
    return () => clearTimeout(timer)
  }, [leaving, exitMs])

  const present = new Set(live.map((entry) => entry.key))
  const entries: PresenceEntry<T>[] = live.map(({ key, item }) => ({ key, item, leaving: false }))
  for (const entry of leaving) {
    // Re-attaching the same file before its ghost expires: the live one wins.
    if (present.has(entry.key)) continue
    entries.splice(Math.min(entry.index, entries.length), 0, {
      key: entry.key,
      item: entry.item,
      leaving: true,
    })
  }
  return entries
}
