import { useLayoutEffect, useState, type RefObject } from 'react'

/**
 * Breathing room between the header and the anchored turn.
 *
 * 32 is not a taste value. It matches the transcript's own `py-8`, which is the
 * space the first message of a chat already gets — so an anchored turn sits
 * exactly where an unanchored one would. It also makes the arithmetic close:
 * with one short turn and no history the content comes to precisely the
 * viewport height, so the floor cannot conjure a scrollbar with 8px of travel
 * and make `useScrollbarGutter` inset the composer band for nothing.
 */
export const TURN_TOP_GAP_PX = 32

/**
 * How tall to make the newest turn's box, so that working on it moves nothing.
 *
 * The transcript is pinned to its bottom, which turns any height change into
 * whole-screen movement: a step arriving grew the block ~34px and slid the
 * conversation up, then 900ms later its grace window expired, it collapsed, and
 * everything slid back down. Every step was a full-viewport round trip.
 *
 * Give the turn a floor of one viewport and that stops. Steps, thinking and the
 * answer all grow and collapse *inside* a box whose height does not change, so
 * the document's height does not change, so the pin has nothing to follow.
 *
 * Two things have to come out of the reservation, and getting either wrong
 * scrolls the turn up under the header rather than leaving it below:
 *
 *  - `bottomInset`, the padding the floating composer overlays;
 *  - `trailing`, whatever sits between the turn and the end of the scrollable
 *    content. That is the transcript's own bottom padding today, which is why
 *    it is measured rather than assumed — an earlier version hardcoded neither
 *    and put the lecturer's message 40px above the top of the viewport.
 *
 * Both are measured from the scroll container and the turn's own box, never
 * from the turn's *contents*: a version that re-measured the turn lagged a
 * frame behind every step, which was the jitter it was meant to remove. What
 * is measured here changes on resize and nothing else — `trailing` is padding,
 * so it holds still however tall the turn grows.
 *
 * Once the turn outgrows the floor the min-height stops applying on its own and
 * ordinary bottom-following resumes, which is what a long answer needs.
 */
export function useTurnMinHeight({
  scrollRef,
  contentRef,
  turnRef,
  bottomInset,
}: {
  scrollRef: RefObject<HTMLElement | null>
  /** The scrollable content's outermost box, padding included. */
  contentRef: RefObject<HTMLElement | null>
  /** The turn's own box, so the space below it can be measured. */
  turnRef: RefObject<HTMLElement | null>
  bottomInset: number
}): number {
  const [height, setHeight] = useState(0)

  useLayoutEffect(() => {
    const scroller = scrollRef.current
    if (!scroller) return undefined

    const measure = () => {
      const content = contentRef.current
      const turn = turnRef.current
      // A difference of two bottom edges: padding only, so it is the same
      // number whether the turn is one line tall or fills the screen.
      const trailing =
        content && turn
          ? Math.max(0, content.getBoundingClientRect().bottom - turn.getBoundingClientRect().bottom)
          : 0
      const next = Math.max(
        0,
        Math.round(scroller.clientHeight - bottomInset - trailing - TURN_TOP_GAP_PX),
      )
      setHeight((previous) => (Math.abs(previous - next) > 1 ? next : previous))
    }

    measure()
    if (typeof ResizeObserver === 'undefined') return undefined
    // The scroll container only. Observing the turn is what made an earlier
    // version re-measure on every step and lag a frame behind each one.
    const observer = new ResizeObserver(measure)
    observer.observe(scroller)
    return () => observer.disconnect()
  }, [scrollRef, contentRef, turnRef, bottomInset])

  return height
}
