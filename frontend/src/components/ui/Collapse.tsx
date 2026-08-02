import { useEffect, useState, type ReactNode } from 'react'

/**
 * A form section that opens and closes with its own height.
 *
 * The forms did this with a bare `{open && <div>…</div>}`, so a whole block of
 * fields appeared and vanished between frames and everything below it jumped
 * by however tall it happened to be. That is most of a screen on "Show
 * optional details", and one field on "Set a time limit" — both abrupt enough
 * to lose your place.
 *
 * `grid-template-rows: 0fr ↔ 1fr` rather than a measured pixel height. The
 * chat composer measures, because its content changes size while open — a
 * growing textarea, attachment tiles arriving. A form section is a fixed block
 * that is either shown or not, and the grid technique needs no ResizeObserver,
 * no inline style and no re-measure when the contents reflow at a different
 * width.
 *
 * Children stay mounted while closed. They hold form state, and unmounting
 * would clear a field the lecturer had filled in before collapsing the
 * section.
 */

/** Must match `.mila-collapse`'s transition duration in index.css. */
const COLLAPSE_MS = 260

export function Collapse({
  open,
  children,
  className = '',
}: {
  open: boolean
  children: ReactNode
  className?: string
}) {
  /* The collapsing box has to clip, or its contents spill out of a section
     that is supposed to be closed. But an *open* section must not clip: these
     are form fields, and a focus ring or a dropdown that opens upward would be
     cut off at the boundary. So it clips only while moving. */
  const [clipping, setClipping] = useState(!open)

  useEffect(() => {
    if (!open) {
      setClipping(true)
      return undefined
    }
    const timer = setTimeout(() => setClipping(false), COLLAPSE_MS)
    return () => clearTimeout(timer)
  }, [open])

  return (
    <div
      className={`mila-collapse ${className}`}
      data-open={open ? 'true' : undefined}
      data-clipping={clipping ? 'true' : undefined}
      /* `inert`, not just `aria-hidden`.
         Children stay mounted so they keep their form state and so the close
         can animate — which leaves focusable fields inside a section that is
         zero pixels tall. `aria-hidden` alone would hide them from a screen
         reader while leaving them in the tab order, which is worse than
         either: Tab would land on a control nobody can see. `inert` takes them
         out of both. */
      inert={!open || undefined}
    >
      <div>{children}</div>
    </div>
  )
}
