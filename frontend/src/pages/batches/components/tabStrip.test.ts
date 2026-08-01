import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

/**
 * The batch tabs grew a vertical scrollbar down their right-hand side — stepper
 * arrows and all — over a single pixel of border.
 *
 * `overflow-x: auto` forces a `visible` `overflow-y` to compute to `auto`
 * (CSS Overflow 3 §3), and `-mb-px` on the tabs (the trick that lays each tab's
 * own underline over the strip's rule) leaves them overhanging their container
 * by exactly 1px. Scrollable axis, scrollbar.
 *
 * jsdom computes no layout, so neither a render test nor TypeScript can see
 * this. What can be checked is that the two halves never sit in the same
 * element again, and that the shadow-drawn rule they were replaced with is
 * still in the stylesheet.
 */

const strip = readFileSync(new URL('./BatchDetailView.tsx', import.meta.url), 'utf8')
const css = readFileSync(new URL('../../../index.css', import.meta.url), 'utf8')

describe('the batch tab strip', () => {
  it('scrolls sideways without becoming scrollable downwards', () => {
    expect(strip).toContain('overflow-x-auto')
    expect(strip).not.toContain('-mb-px')
  })

  it('draws its rule as an inset shadow, so the tabs need no negative margin', () => {
    expect(strip).toContain('mila-tabstrip')
    expect(css).toMatch(/\.mila-tabstrip\s*\{[^}]*box-shadow:\s*inset 0 -1px 0/)
  })

  it('still underlines the active tab over that rule', () => {
    // 2px of tab border covering the 1px shadow is the whole point of the
    // construction; losing it would leave the active tab unmarked.
    expect(strip).toContain('border-b-2')
  })
})
