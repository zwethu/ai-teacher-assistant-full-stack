import { useLayoutEffect, type RefObject } from 'react'

/** The CSS variable overlays read to stay clear of the scrollbar. */
export const SCROLLBAR_GUTTER_VAR = '--chat-scrollbar-gutter'

/**
 * Publishes a scroll container's actual scrollbar width as a CSS variable on
 * the document root.
 *
 * The composer floats over the transcript in a band that spans the whole
 * column, and the scrollbar belongs to the transcript painted behind it — so
 * anything the band paints lands on top of the thumb. Insetting the band by a
 * hardcoded width only works if that width is right, and it is not knowable
 * from CSS: `::-webkit-scrollbar` sizing applies in Chromium and Safari,
 * Firefox picks its own for `scrollbar-width: thin`, and an overlay scrollbar
 * (macOS, and Chromium's overlay mode) occupies no width at all.
 *
 * `offsetWidth - clientWidth` is the one source of truth, and it reports 0 when
 * there is no gutter — so nothing is left unpainted on the platforms that do
 * not reserve one.
 */
export function useScrollbarGutter(ref: RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    const node = ref.current
    if (!node) return undefined

    const update = () => {
      const gutter = Math.max(0, node.offsetWidth - node.clientWidth)
      document.documentElement.style.setProperty(SCROLLBAR_GUTTER_VAR, `${gutter}px`)
    }

    update()
    // The content box is what shrinks when a scrollbar appears, so growing the
    // conversation past one screen reports here without watching the messages.
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
    observer?.observe(node)

    return () => {
      observer?.disconnect()
      // Back to the stylesheet's fallback rather than a stale measurement from
      // a container that no longer exists. Runs whether or not an observer was
      // ever created — the measurement happens either way.
      document.documentElement.style.removeProperty(SCROLLBAR_GUTTER_VAR)
    }
  }, [ref])
}
