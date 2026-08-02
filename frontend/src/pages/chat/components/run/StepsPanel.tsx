import { useEffect, useRef, useState, type CSSProperties } from 'react'

import { usePresenceList } from '../../../../hooks/usePresenceList'
import type { NormalizedRunRow } from './normalizeRunRows'
import { StepTimelineRow } from './StepTimelineRow'
import type { RunLane } from './useRunLanes'

/** Between lanes of one fan-out. Short enough to read as a group arriving. */
const STAGGER_MS = 45
/** Past this the tail of a wide fan-out would feel like lag, not cascade. */
const MAX_STAGGER_STEPS = 3

/**
 * Must equal `.mila-step-row`'s transition duration in index.css — *both*
 * directions, which is the point.
 *
 * A lane opening and another closing on the same frame changes the container's
 * height by `+h·E(t)` and `−h·X(t)`. When the two curves are identical those
 * cancel exactly and the height does not move at all. When they are not, they
 * very nearly do — and "very nearly" is the notch. Evaluating the old pairing
 * (240ms in, 180ms out, same ease-out) put the container at 0.891 of a row
 * 30ms in, and at 0.174 once the arriving lane carried the fan-out stagger.
 * Matched, it is a flat 1.000 throughout.
 */
export const STEP_EXIT_MS = 240

/**
 * How long the outgoing content lingers when a lane changes hands.
 *
 * Must outlast `.mila-lane__out`'s 200ms, or the element is unmounted partway
 * through its own departure — which is the one way a fade genuinely does
 * become an instant disappearance.
 */
export const LANE_SWAP_MS = 300

type Props = {
  /** The settled list, shown after a run. Never changes, so it opts out of motion. */
  rows?: NormalizedRunRow[]
  /** The live lanes. Passed instead of `rows` while a run is going. */
  lanes?: RunLane[]
  live?: boolean
}

export function StepsPanel({ rows = [], lanes = [], live = false }: Props) {
  if (live) return <LiveStepsPanel lanes={lanes} />
  if (rows.length === 0) return null

  return (
    <div className="space-y-1.5">
      {rows.map((row) => (
        <StepTimelineRow key={row.id} row={row} />
      ))}
    </div>
  )
}

/**
 * Staggers lanes that open on the *same* render, not by their position — a
 * parallel fan-out cascades, while a single lane that happens to be third
 * still opens immediately rather than waiting out a delay it did not earn.
 *
 * Suppressed entirely on a commit that also closes a lane. The stagger is a
 * delay on the opening height only, so on a mixed commit it un-pairs the two
 * curves that were supposed to cancel — which is precisely the 0.174 case
 * above. A wave that both opens and closes lanes moves as one piece.
 *
 * Departures are read off this hook's own record of what it saw last render,
 * not off the presence list. The presence list only learns of a departure in
 * an effect, so on the render where the lanes actually change it still reports
 * nothing leaving — and the delays for that render, which are the only ones
 * that matter, were assigned before the suppression could apply.
 */
function useArrivalStagger(ids: string[]): (id: string) => number {
  const seen = useRef(new Set<string>())
  const delays = useRef(new Map<string, number>())

  const present = new Set(ids)
  const arriving = ids.filter((id) => !seen.current.has(id))
  const departing = [...seen.current].filter((id) => !present.has(id))

  arriving.forEach((id, index) => {
    const delay = departing.length > 0 ? 0 : Math.min(index, MAX_STAGGER_STEPS) * STAGGER_MS
    delays.current.set(id, delay)
    seen.current.add(id)
  })

  for (const id of departing) {
    seen.current.delete(id)
    delays.current.delete(id)
  }

  return (id) => delays.current.get(id) ?? 0
}

/**
 * One lane's contents, crossfading when the lane changes hands.
 *
 * Both rows occupy the same grid cell, so the outgoing one costs no layout on
 * its way out and the lane's height is simply the taller of the two. That is
 * what makes a sequential run completely still: step A finishing and step B
 * starting is one slot changing what it says, with no row inserted or removed
 * and nothing for the height to do.
 */
function LaneContent({ row }: { row: NormalizedRunRow }) {
  const previous = useRef(row)
  const [outgoing, setOutgoing] = useState<NormalizedRunRow | null>(null)

  useEffect(() => {
    const prior = previous.current
    previous.current = row
    // The same row reaching "Done" is not a swap — the badge has its own
    // motion, and crossfading the whole line for it would be a flicker.
    if (prior.id === row.id) return undefined
    setOutgoing(prior)
    const timer = setTimeout(() => setOutgoing(null), LANE_SWAP_MS)
    return () => clearTimeout(timer)
  }, [row])

  return (
    /* Clipped, so the swap cannot reach outside this lane. The parts travel
       sideways now and a row is only as wide as its card — without this the
       leaving step would slide out over whatever sits beside it, the same way
       the earlier upward version reached into the row above. */
    <div className="grid overflow-hidden">
      <div key={row.id} className="mila-lane__in [grid-area:1/1]">
        <StepTimelineRow row={row} />
      </div>
      {outgoing && (
        // Hidden from assistive tech: it is a frame of the previous state on
        // its way out, and announcing a step that has already been replaced
        // would be a lie told twice.
        <div key={outgoing.id} aria-hidden="true" className="mila-lane__out [grid-area:1/1]">
          <StepTimelineRow row={outgoing} />
        </div>
      )}
    </div>
  )
}

function LiveStepsPanel({ lanes }: { lanes: RunLane[] }) {
  const entries = usePresenceList(lanes, (lane) => lane.id, STEP_EXIT_MS)
  // Fed the caller's lanes, not the presence entries: the ghosts of closing
  // lanes are exactly what this must not count as present.
  const staggerOf = useArrivalStagger(lanes.map((lane) => lane.id))

  if (entries.length === 0) return null

  return (
    // Negative margin cancels the last lane's own spacing. The spacing sits
    // inside each lane so it collapses with it — left on the parent it would
    // outlive the lane and leave a gap where it used to be.
    <div className="-mb-1.5">
      {entries.map(({ key, item, leaving }) => (
        <div
          key={key}
          // One class in both states, flipped by an attribute. Swapping classes
          // would work too, but this keeps a single transition definition on the
          // element — which is what lets a lane told to close mid-open reverse
          // from where it actually is instead of jumping.
          className="mila-step-row"
          data-leaving={leaving ? 'true' : undefined}
          style={leaving ? undefined : ({ '--mila-step-delay': `${staggerOf(key)}ms` } as CSSProperties)}
        >
          <div className="pb-1.5">
            <LaneContent row={item.row} />
          </div>
        </div>
      ))}
    </div>
  )
}
