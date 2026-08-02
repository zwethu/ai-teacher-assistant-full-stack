/**
 * One definition of what a form control looks like.
 *
 * Every input in the app used to carry its own hand-written class string, and
 * they had drifted: three paddings, two label gaps, and — in twenty-eight
 * places — `focus:ring-violet-500` with no ring *width* beside it. Tailwind
 * emits only `--tw-ring-color` for that, so no ring was ever drawn; and with
 * no `outline-none` either, what the lecturer actually saw on focus was
 * Chrome's default black outline. The brand's focus colour was declared and
 * then never rendered, on every text field in the product.
 *
 * Padding and radius are the design system's own (`.maia-control` in
 * `design-system/components/forms/Input.jsx`): 10px/12px. Stated as Tailwind
 * rather than by importing that CSS, because these controls sit in Tailwind
 * layouts and mixing the two cascades is how the drift started.
 *
 * **Focus is a solid two-pixel violet edge, and nothing else.** The design
 * system pairs its border with a 3px `--focus-ring` glow — violet-600 at 40%
 * — and on white that blend is a desaturated lilac-grey at 1.9:1, which reads
 * as a smudge of black around the field rather than as brand colour. So the
 * ring is kept but made solid violet-500 at 1px, sitting directly outside the
 * 1px border of the same colour: one crisp 2px edge, no halo.
 *
 * That is also the stronger indicator of the two. Measured on white, violet-500
 * is 5.05:1 against both the field's fill and the page — well past the 3:1 a
 * focus indicator owes — and 2px of it satisfies the perimeter thickness the
 * glow version was leaning on decoration to imply.
 */

/* Everything except the border colour, which is the one thing the valid and
   invalid variants disagree on. Kept out of the shared part deliberately:
   `border-red-400` and `border-slate-300` are both plain `border-color`
   utilities at equal specificity, so which won would come down to their order
   in the generated stylesheet rather than to anything written here. The two
   variants below are alternatives, never combined.

   The `focus:` colours are safe to mix in, at 0,2,0 against a base class's
   0,1,0 — they win wherever they land. */
const FIELD_SHAPE =
  'block w-full rounded-md border bg-white px-3 py-2.5 text-sm text-slate-800 ' +
  'transition-colors placeholder:text-slate-400 focus:outline-none focus:ring-1 ' +
  // Grayscale fill and a not-allowed cursor rather than a blanket opacity,
  // which reads as "loading" rather than "you cannot use this".
  'disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400'

/**
 * Text inputs, textareas, and `SelectField`'s trigger.
 *
 * Hover is violet-300, not slate-400. Darkening the grey was the reflex, but a
 * field that answers the pointer by turning a *deeper grey* reads as an edge
 * getting heavier rather than as the control waking up — and against the violet
 * it takes on a moment later, the grey looks like a different system's idea of
 * hover. Violet-300 is the same hue arriving quietly: unmistakably a response,
 * and unmistakably ours. Focus then goes to the full violet-500.
 */
export const FIELD_CLASS =
  `${FIELD_SHAPE} border-slate-300 hover:border-violet-300 focus:border-violet-500 focus:ring-violet-500`

/**
 * The same field, failing validation. Swapped for `FIELD_CLASS` rather than
 * appended to it. Colour alone is not the error — the caller still owes an
 * icon and a message, since a red border is invisible to roughly one in eight
 * readers.
 */
export const FIELD_INVALID_CLASS =
  `${FIELD_SHAPE} border-red-400 hover:border-red-500 focus:border-red-500 focus:ring-red-500`

/** Multi-line. Vertical resize only — sideways drags break the grid it sits in. */
export const TEXTAREA_CLASS = `${FIELD_CLASS} resize-y`

/** The label above a field. 6px below it, matching the design system's `Field`. */
export const FIELD_LABEL_CLASS = 'block text-sm font-semibold text-slate-700 mb-1.5'

/**
 * Just the focus treatment, for controls that keep their own shape — a compact
 * inline editor, say. Everything that can take `FIELD_CLASS` should.
 */
export const FIELD_FOCUS_CLASS =
  'focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500'

/**
 * A checkbox has no room for a ring against its own border, so this one is
 * offset — a gap of white, then the violet. Solid, like the fields above.
 *
 * `focus-visible`, not `focus`, and this is the one control where the
 * difference shows. A text field earns a ring on click: it is about to receive
 * typing, and the ring says where that typing will go. A checkbox has already
 * answered by the time you let go of the mouse — the tick *is* the feedback —
 * so a ring that lingers afterwards reads as a stuck violet block around it
 * rather than as focus. Keyboard users, who have no tick to look at until they
 * press space, still get it.
 */
export const CHECKBOX_CLASS =
  'h-4 w-4 rounded border-slate-300 text-violet-600 accent-violet-600 ' +
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2'
