import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react'

/**
 * Which side of a trigger its popup should open on, and how tall it may be.
 *
 * Both popups in this folder started with a guessed constant for their own
 * height — 264px for the dropdown, 380px for the calendar. The dropdown's
 * happened to be right because its `max-height` was the same number; the
 * calendar's stopped being right the moment a time picker was added to it, and
 * the panel ran off the bottom of the page and under the footer. A number that
 * has to be kept in sync with a layout by hand will drift out of sync with it.
 *
 * So this measures the panel that is actually on screen. It also returns a
 * `maxHeight`, for the case neither side has room: better a panel that scrolls
 * than one cut off by the viewport.
 *
 * Measured in a layout effect and re-measured on scroll and resize, because a
 * popup that was correctly placed when it opened is wrong the moment the page
 * moves under it.
 *
 * The edge it flips at is the nearest declared boundary, not always the
 * viewport. The calendar's hour and minute dropdowns sit on the bottom edge of
 * the calendar panel: measured against the window there is often plenty of
 * room below them, and the menu opened downward and hung out of the panel it
 * belongs to. `PopoverBoundary` is how a container says "flip at my edge".
 */

/**
 * Declares a clipping edge for any popup rendered inside it.
 *
 * A context rather than a prop, because the boundary is a fact about where a
 * control has been *placed*, not about the control — `SelectField` should not
 * have to grow an API for every surface that might one day contain it.
 */
const BoundaryContext = createContext<RefObject<HTMLElement | null> | null>(null)

export function PopoverBoundary({
  value,
  children,
}: {
  value: RefObject<HTMLElement | null>
  children: ReactNode
}) {
  return <BoundaryContext.Provider value={value}>{children}</BoundaryContext.Provider>
}

type Placement = {
  dropUp: boolean
  /** Undefined when the panel fits as it is — no cap, so no scrollbar. */
  maxHeight: number | undefined
}

type Options = {
  /** Gap between trigger and panel; must match the caller's margin utility. */
  gap?: number
  /** Breathing room kept between the panel and the edge of the viewport. */
  margin?: number
  /** Used for the first measurement, before the panel has been laid out. */
  fallbackHeight?: number
}

export function useFlipPlacement(
  wrapRef: RefObject<HTMLElement | null>,
  panelRef: RefObject<HTMLElement | null>,
  open: boolean,
  { gap = 6, margin = 8, fallbackHeight = 320 }: Options = {},
): Placement {
  const boundary = useContext(BoundaryContext)
  const [placement, setPlacement] = useState<Placement>({ dropUp: false, maxHeight: undefined })
  // Read through a ref so `measure` stays stable and the listeners bind once.
  const latest = useRef(placement)
  latest.current = placement

  const measure = useCallback(() => {
    const wrap = wrapRef.current
    const panel = panelRef.current
    if (!wrap || !panel) return

    const box = wrap.getBoundingClientRect()
    // `scrollHeight`, not `offsetHeight`: once a previous pass has capped the
    // panel, its offset height *is* the cap, and measuring that would keep it
    // capped for as long as it stayed open.
    const wanted = panel.scrollHeight || fallbackHeight

    /* Intersected with the viewport, never widened by it: a boundary can only
       take room away. A container that is itself partly off-screen must not
       hand a popup space that is not on the page. */
    const edge = boundary?.current?.getBoundingClientRect()
    const floor = Math.min(window.innerHeight, edge ? edge.bottom : Number.POSITIVE_INFINITY)
    const ceiling = Math.max(0, edge ? edge.top : 0)

    const below = floor - box.bottom - gap - margin
    const above = box.top - ceiling - gap - margin

    const dropUp = wanted > below && above > below
    const room = dropUp ? above : below
    const next: Placement = {
      dropUp,
      maxHeight: wanted > room ? Math.max(room, 160) : undefined,
    }
    // Placement feeds back into layout, so an unconditional write would be a
    // measure/paint loop on every scroll frame.
    if (next.dropUp !== latest.current.dropUp || next.maxHeight !== latest.current.maxHeight) {
      setPlacement(next)
    }
  }, [wrapRef, panelRef, boundary, gap, margin, fallbackHeight])

  useLayoutEffect(() => {
    if (!open) return
    measure()
  })

  /* A second pass, after paint.
     React attaches refs child-first, so a popup that mounts already open
     inside a container runs its own layout effect *before* the container's ref
     callback — and measures against a boundary that is still null. Passive
     effects run once every ref in the commit is attached, so this catches that
     case. It is a no-op whenever the layout pass already had what it needed,
     since `measure` only writes on a change. */
  useEffect(() => {
    if (open) measure()
  }, [open, measure])

  useEffect(() => {
    if (!open) return undefined
    // Capture phase, so a scroll inside any ancestor is caught too, not just
    // the one on the window.
    window.addEventListener('scroll', measure, true)
    window.addEventListener('resize', measure)
    return () => {
      window.removeEventListener('scroll', measure, true)
      window.removeEventListener('resize', measure)
    }
  }, [open, measure])

  return placement
}
