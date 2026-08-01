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
  // `after` is the key of whatever sat directly above this item when it left.
  // See the reinsertion below for why the index alone is not enough.
  const [leaving, setLeaving] = useState<{ key: string; item: T; index: number; after: string | null }[]>([])

  useEffect(() => {
    const present = new Set(live.map((entry) => entry.key))
    const departing = previous.current.filter((entry) => !present.has(entry.key))
    const gone = departing.map((entry) => ({
      ...entry,
      after: previous.current[entry.index - 1]?.key ?? null,
    }))
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
    // Anchored to the neighbour it left behind, not to the index it used to
    // hold. Those stop agreeing the moment anything else in the list moves —
    // and with parallel agent steps, several rows come and go while one is
    // still animating out, so a ghost pinned to a stale index visibly jumped
    // to a different position on its way off screen.
    const anchor = entry.after ? entries.findIndex((item) => item.key === entry.after) : -1
    const at = anchor >= 0 ? anchor + 1 : Math.min(entry.index, entries.length)
    entries.splice(at, 0, {
      key: entry.key,
      item: entry.item,
      leaving: true,
    })
  }
  return entries
}
