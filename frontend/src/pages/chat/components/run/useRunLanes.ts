import { useRef } from 'react'

import { isRowActive, type NormalizedRunRow } from './normalizeRunRows'

/**
 * The live view as *lanes*, not as a list.
 *
 * ── Why ────────────────────────────────────────────────────────────────────
 *
 * This used to be a list whose membership churned: a finished row was held for
 * a 900ms grace window and then dropped. Driving the real hook through a
 * realistic run and logging the visible row count showed what that costs.
 *
 *   sequential run          fan-out of three
 *   ──────────────          ────────────────
 *   1 row   A starts        3 rows
 *   1 row   A done          3 rows  A done
 *   0 rows  ← window up     3 rows  B done
 *   1 row   B starts        1 row   ← A and B's windows expire together
 *   1 row   B done          2 rows  ← C's completion puts one back
 *   0 rows  ← window up     1 row
 *                           0 rows
 *
 * The agent usually thinks for longer than 900ms between tool calls, so on a
 * sequential run the panel reached *zero* rows between every step: the whole
 * block collapsed and reopened, moving the thinking line and the conversation
 * with it, twice per step. And the fan-out count is not even monotonic —
 * timers expiring on their own schedule took it 3 → 1 → 2 → 1, which reads as
 * a stutter because it is one.
 *
 * ── The model ──────────────────────────────────────────────────────────────
 *
 * A lane is a slot for one unit of concurrent work. A step finishing and the
 * next one starting is a *content change within a lane* — a crossfade — not a
 * removal followed by an insertion. So a sequential run holds exactly one lane
 * from its first step to its last and never changes height at all.
 *
 * Lane count follows real concurrency, and only real concurrency:
 *
 *  · An active row keeps whatever lane it was given, for as long as it lives.
 *  · A new active row prefers the *oldest lane holding a finished row* — that
 *    is the crossfade, and it is why sequential work never moves.
 *  · A finished row stays in its lane indefinitely, with its "Done" badge. No
 *    timer: the lane is what the agent most recently did in that slot, and it
 *    stays true until something replaces it.
 *  · Lanes still holding finished rows close only when a new wave of work
 *    arrives and does not need them — one height change, at a moment that
 *    means something, instead of a timer firing mid-run.
 *
 * The floor falls out of this: while a run is going, the lanes are never
 * emptied by anything except the run ending.
 */

export type RunLane = {
  /** Stable across the rows that pass through it — this is the crossfade key. */
  id: string
  row: NormalizedRunRow
}

export function useRunLanes(rows: NormalizedRunRow[]): RunLane[] {
  // laneId → the row currently shown in it.
  const lanes = useRef<Map<string, NormalizedRunRow>>(new Map())
  // rowId → laneId, so an active row keeps its lane between renders.
  const laneOf = useRef<Map<string, string>>(new Map())
  const nextLane = useRef(0)

  const byId = new Map(rows.map((row) => [row.id, row]))
  const active = rows.filter(isRowActive)

  // 1. Drop lanes whose row the run has forgotten entirely. `normalizeRunRows`
  //    rewrites rather than removes, so this is rare — but a row that vanishes
  //    must not strand its lane.
  for (const [laneId, row] of [...lanes.current]) {
    if (!byId.has(row.id)) {
      lanes.current.delete(laneId)
      laneOf.current.delete(row.id)
    }
  }

  // 2. Refresh every lane from the current row data, so a row that changes
  //    state while it sits in a lane — running → done — shows it.
  for (const [laneId, row] of lanes.current) {
    const fresh = byId.get(row.id)
    if (fresh) lanes.current.set(laneId, fresh)
  }

  // 3. Place active rows. Insertion order is the age order of a Map, so the
  //    first finished lane found is the oldest — the one whose content has
  //    been read already and is the least costly to replace.
  const claimed = new Set<string>()
  for (const [laneId, row] of lanes.current) {
    if (isRowActive(row) && byId.has(row.id)) claimed.add(laneId)
  }

  let placedNew = false
  for (const row of active) {
    const existing = laneOf.current.get(row.id)
    if (existing && lanes.current.has(existing)) {
      lanes.current.set(existing, row)
      claimed.add(existing)
      continue
    }
    const reusable = [...lanes.current.keys()].find(
      (laneId) => !claimed.has(laneId) && !isRowActive(lanes.current.get(laneId)!),
    )
    const laneId = reusable ?? `lane-${(nextLane.current += 1)}`
    lanes.current.set(laneId, row)
    laneOf.current.set(row.id, laneId)
    claimed.add(laneId)
    placedNew = true
  }

  // 4. A new wave has arrived and these lanes were not needed for it, so the
  //    concurrency they represent is over. Closing them here — rather than on
  //    a timer — is what makes every height change correspond to something the
  //    agent actually did.
  if (placedNew) {
    for (const [laneId, row] of [...lanes.current]) {
      if (claimed.has(laneId)) continue
      lanes.current.delete(laneId)
      laneOf.current.delete(row.id)
    }
  }

  // 5. Joining a run that is between steps — a reload mid-run, or an agent
  //    thinking after its last tool returned. Nothing is active and no lane
  //    has been opened yet, so seed one with the most recent thing that
  //    happened rather than showing an empty panel that collapses the block.
  if (lanes.current.size === 0 && rows.length > 0) {
    const last = rows[rows.length - 1]
    const laneId = `lane-${(nextLane.current += 1)}`
    lanes.current.set(laneId, last)
    laneOf.current.set(last.id, laneId)
  }

  return [...lanes.current].map(([id, row]) => ({ id, row }))
}
