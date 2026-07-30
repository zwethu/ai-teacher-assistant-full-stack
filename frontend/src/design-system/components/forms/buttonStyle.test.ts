import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

/**
 * The primary button used to read as a moulded 3D pill. Three cues did that,
 * and any one of them coming back brings the look back with it:
 *
 *   - a 180deg light→dark gradient, which reads as a lit dome
 *   - `inset 0 1px 0 rgba(255,255,255,…)`, a bevel along the top edge
 *   - `translateY(1px)` on press, mimicking a key travelling down
 *
 * The replacement is a flat fill, a soft shadow that grows on hover, and a
 * `scale(.97)` press. Nothing else in the pipeline can see this — the styles
 * are injected at runtime from a string, so neither the type checker nor a
 * render test would notice the surface going back to a gradient.
 */

const source = readFileSync(new URL('./Button.jsx', import.meta.url), 'utf8')

/** The injected stylesheet, i.e. everything inside the CSS template literal. */
const css = /const CSS = `([\s\S]*?)`/.exec(source)?.[1] ?? ''

function rule(selector: string): string {
  const match = new RegExp(`\\${selector}\\{([^}]*)\\}`).exec(css)
  return match?.[1] ?? ''
}

describe('Button surface', () => {
  it('has an injected stylesheet to inspect', () => {
    expect(css.length).toBeGreaterThan(0)
  })

  it('fills flat, with no gradient and no bevel', () => {
    const primary = rule('.maia-btn--primary')
    expect(primary).toContain('background-color:var(--violet-600)')
    expect(primary, 'gradient fill is back').not.toContain('linear-gradient')
    expect(primary, 'inner bevel highlight is back').not.toContain('inset')
  })

  it('presses by scaling, not by dropping', () => {
    expect(rule('.maia-btn:active')).toContain('scale(.97)')
    expect(css, 'the physical key-travel press is back').not.toContain('translateY(1px)')
  })

  it('transitions named properties rather than everything', () => {
    // `transition: all` animates layout properties too and is the usual cause
    // of a button that feels vague under the cursor.
    expect(css).not.toMatch(/transition:\s*all/)
    expect(rule('.maia-btn')).toContain('transform 140ms')
  })

  it('gates hover behind a fine pointer', () => {
    // Without this a tap on a touch device leaves the button stuck looking
    // hovered until something else steals focus.
    expect(css).toContain('@media (hover:hover) and (pointer:fine)')
  })

  it('drops the press transform under reduced motion', () => {
    const reduced = css.slice(css.indexOf('prefers-reduced-motion'))
    expect(reduced).toContain('.maia-btn:active{transform:none}')
  })
})
