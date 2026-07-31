import { useRef } from 'react'

import { usePresenceList } from '../../../../hooks/usePresenceList'
import type { NormalizedRunRow } from './normalizeRunRows'
import { StepTimelineRow } from './StepTimelineRow'

/** Between rows of one fan-out. Short enough to read as a group arriving. */
const STAGGER_MS = 45
/** Past this the tail of a wide fan-out would feel like lag, not cascade. */
const MAX_STAGGER_STEPS = 3
/**
 * Must equal `.mila-step-out`'s duration in index.css. On the presence hook's
 * 200ms default the row was unmounted while its collapse still had 40ms to
 * run, so the last of the height vanished in one frame instead of easing shut.
 */
const STEP_EXIT_MS = 240

type Props = {
  rows: NormalizedRunRow[]
  /**
   * The live view during a run, which holds the steps still in flight plus the
   * ones that have just finished. Rows come and go constantly here, so they
   * need presence to leave rather than blink out. The finished list never
   * changes, so it opts out.
   */
  live?: boolean
}

export function StepsPanel({ rows, live = false }: Props) {
  if (live) return <LiveStepsPanel rows={rows} />
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
 * Staggers rows that arrive on the *same* render, not by their position in the
 * list. A parallel fan-out cascades; a single step that happens to land third
 * still enters immediately, rather than waiting out a delay it did not earn.
 */
function useArrivalStagger(ids: string[]): (id: string) => number {
  const seen = useRef(new Set<string>())
  const delays = useRef(new Map<string, number>())

  const arriving = ids.filter((id) => !seen.current.has(id))
  arriving.forEach((id, index) => {
    delays.current.set(id, Math.min(index, MAX_STAGGER_STEPS) * STAGGER_MS)
    seen.current.add(id)
  })

  const present = new Set(ids)
  for (const id of [...seen.current]) {
    if (!present.has(id)) {
      seen.current.delete(id)
      delays.current.delete(id)
    }
  }

  return (id) => delays.current.get(id) ?? 0
}

function LiveStepsPanel({ rows }: { rows: NormalizedRunRow[] }) {
  const entries = usePresenceList(rows, (row) => row.id, STEP_EXIT_MS)
  const staggerOf = useArrivalStagger(entries.filter((e) => !e.leaving).map((e) => e.key))

  if (entries.length === 0) return null

  return (
    // Negative margin cancels the last row's own spacing. The spacing sits
    // inside each row so it collapses with the row on exit — left on the
    // parent it would outlive the row and leave a gap where it used to be.
    <div className="-mb-1.5">
      {entries.map(({ key, item, leaving }) => (
        <div
          key={key}
          className={leaving ? 'mila-step-out' : 'mila-step-in'}
          style={leaving ? undefined : { '--mila-step-delay': `${staggerOf(key)}ms` } as React.CSSProperties}
        >
          <div className="pb-1.5">
            <StepTimelineRow row={item} />
          </div>
        </div>
      ))}
    </div>
  )
}
