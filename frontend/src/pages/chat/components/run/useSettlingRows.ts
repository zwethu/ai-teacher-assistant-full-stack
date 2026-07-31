import { useEffect, useRef, useState } from 'react'

import { isRowActive, type NormalizedRunRow } from './normalizeRunRows'

/**
 * How long a finished step stays in the live view wearing its "Done" badge.
 *
 * Long enough to read as a step completing rather than a row that blinked.
 */
export const STEP_SETTLE_MS = 900

/**
 * The rows the live view should show: everything still in flight, plus
 * everything that has just finished — in the order they first appeared.
 *
 * Filtering to `isRowActive` alone means a step's completion is never visible —
 * the row is dropped on the same frame its status flips, so the green "Done"
 * it earned renders for nobody. Holding it briefly is what turns a
 * disappearance into a completion.
 *
 * Timed from when *this view* saw the row settle, not from any timestamp on the
 * row: the agent stamps events in seconds and the backend in milliseconds, and
 * neither says anything about when the row reached the screen.
 *
 * The ordering is not incidental. `normalizeRunRows` sorts by `updated_at`, so
 * a step's completion event pushes it *past* the steps still running — with a
 * parallel fan-out, finishing meant hopping to the bottom of the list, showing
 * "Done" somewhere new, and collapsing from there, while everything above it
 * slid up to fill the gap it left behind. Arrival order holds each row still
 * for as long as it is on screen.
 */
export function useSettlingRows(
  rows: NormalizedRunRow[],
  graceMs: number = STEP_SETTLE_MS,
): NormalizedRunRow[] {
  const settledAt = useRef(new Map<string, number>())
  const arrivedAt = useRef(new Map<string, number>())
  const nextArrival = useRef(0)
  const started = useRef(false)
  const [, tick] = useState(0)

  const now = Date.now()
  const map = settledAt.current
  const order = arrivedAt.current

  const present = new Set<string>()
  for (const row of rows) {
    present.add(row.id)
    if (!order.has(row.id)) {
      nextArrival.current += 1
      order.set(row.id, nextArrival.current)
    }
    if (isRowActive(row)) {
      // Back in flight — a retry on the same row starts its clock over.
      map.delete(row.id)
    } else if (!map.has(row.id)) {
      // Anything already finished on the first render settled before this view
      // existed, so it is backdated past the window rather than replaying a
      // batch of completions on mount.
      map.set(row.id, started.current ? now : now - graceMs)
    }
  }
  for (const id of [...map.keys()]) {
    if (!present.has(id)) map.delete(id)
  }
  for (const id of [...order.keys()]) {
    if (!present.has(id)) order.delete(id)
  }
  started.current = true

  const expiryOf = (row: NormalizedRunRow) => (map.get(row.id) ?? now) + graceMs
  const visible = rows
    .filter((row) => isRowActive(row) || expiryOf(row) > now)
    .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))

  // Nothing else re-renders when a grace period simply runs out, so the view
  // has to wake itself up for it.
  const nextExpiry = Math.min(
    ...visible.filter((row) => !isRowActive(row)).map(expiryOf),
    Number.POSITIVE_INFINITY,
  )
  useEffect(() => {
    if (!Number.isFinite(nextExpiry)) return undefined
    const timer = setTimeout(() => tick((value) => value + 1), Math.max(16, nextExpiry - Date.now()))
    return () => clearTimeout(timer)
  }, [nextExpiry])

  return visible
}
