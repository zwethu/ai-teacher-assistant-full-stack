import { describe, expect, it } from 'vitest'

import {
  CHECKBOX_CLASS,
  FIELD_CLASS,
  FIELD_FOCUS_CLASS,
  FIELD_INVALID_CLASS,
  TEXTAREA_CLASS,
} from './fieldStyles'

/**
 * These are strings, so nothing type-checks them. Each assertion below stands
 * for a defect that shipped.
 */
describe('field styles', () => {
  /**
   * The one that was visible on every text field in the product: Tailwind
   * emits only `--tw-ring-color` for a bare `ring-<colour>`, so with no width
   * utility no ring was ever drawn — and with no `outline-none` either, what
   * rendered on focus was the browser's own black outline.
   */
  it.each([
    ['FIELD_CLASS', FIELD_CLASS],
    ['FIELD_INVALID_CLASS', FIELD_INVALID_CLASS],
    ['TEXTAREA_CLASS', TEXTAREA_CLASS],
    ['FIELD_FOCUS_CLASS', FIELD_FOCUS_CLASS],
  ])('%s states a ring width and suppresses the browser outline', (_name, cls) => {
    expect(cls).toMatch(/focus:outline-none/)
    expect(cls).toMatch(/focus:ring-\d/)
  })

  /**
   * Opacity in the ring colour is what made the focus edge read as a grey
   * smudge rather than as brand violet — a 40% violet over white measures
   * 1.9:1, against 5.05:1 for the solid.
   */
  it.each([
    ['FIELD_CLASS', FIELD_CLASS],
    ['FIELD_INVALID_CLASS', FIELD_INVALID_CLASS],
    ['CHECKBOX_CLASS', CHECKBOX_CLASS],
  ])('%s keeps the focus edge solid', (_name, cls) => {
    expect(cls).not.toMatch(/ring-\w+-\d+\//)
  })

  /**
   * A text field earns its ring on click — it is about to receive typing. A
   * checkbox has already answered by the time the pointer lifts, so a ring
   * left behind reads as a stuck violet block around it.
   */
  it('rings a checkbox for the keyboard only', () => {
    expect(CHECKBOX_CLASS).toMatch(/focus-visible:ring-2/)
    expect(CHECKBOX_CLASS).not.toMatch(/(^|\s)focus:ring/)
    // The outline still has to go for both, or the black one comes back.
    expect(CHECKBOX_CLASS).toMatch(/focus:outline-none/)
  })

  /** Hover is the brand's, not a darker grey — see the note in the module. */
  it('answers hover in violet', () => {
    expect(FIELD_CLASS).toMatch(/hover:border-violet-300/)
    expect(FIELD_CLASS).not.toMatch(/hover:border-slate/)
  })

  /**
   * Disabled is a grayscale fill and a not-allowed cursor. A blanket opacity
   * reads as "loading" rather than as "you cannot use this".
   */
  it('makes disabled look disabled rather than pending', () => {
    expect(FIELD_CLASS).toMatch(/disabled:cursor-not-allowed/)
    expect(FIELD_CLASS).toMatch(/disabled:bg-slate-50/)
    expect(FIELD_CLASS).not.toMatch(/disabled:opacity/)
  })

  /** The valid and invalid variants are alternatives, never combined — both
   *  carry a base border colour, and two of those would race on order. */
  it('gives each variant its own resting border', () => {
    expect(FIELD_CLASS).toMatch(/(^|\s)border-slate-300/)
    expect(FIELD_INVALID_CLASS).toMatch(/(^|\s)border-red-400/)
    expect(FIELD_INVALID_CLASS).not.toMatch(/(^|\s)border-slate-300/)
  })
})
