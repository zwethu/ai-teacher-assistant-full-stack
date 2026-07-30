import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

/**
 * The composer's motion is a set of two-state machines split across CSS: a
 * resting rule that declares a property and transitions it, and a `[data-*]`
 * rule that changes it. Drop either half and the component silently
 * misbehaves — the collapse shipped without its open state, so every
 * attachment tile and the web-search strip rendered, measured zero height and
 * were clipped out of existence.
 *
 * Nothing else catches that. TypeScript sees valid props, the unit tests see
 * the right elements in the DOM, and the build has no opinion about whether a
 * transition has anything to transition to. jsdom does not apply this
 * stylesheet either, so the only place to assert it is the stylesheet itself.
 */

const css = readFileSync(new URL('../../../index.css', import.meta.url), 'utf8')

/** Body of the rule whose selector is exactly `selector`. */
function ruleBody(selector: string): string | null {
  const lines = css.split('\n')
  const start = lines.findIndex((line) => line.trim() === `${selector} {`)
  if (start === -1) return null
  const end = lines.findIndex((line, index) => index > start && line.trim() === '}')
  return lines.slice(start + 1, end).join('\n')
}

/** Property names named in a rule's `transition:` shorthand.
 *  Splits on top-level commas only — timing functions carry their own
 *  (`cubic-bezier(0.16, 1, 0.3, 1)`). */
function transitionedProperties(body: string): string[] {
  const match = /transition:([^;]*);/s.exec(body)
  if (!match) return []
  const parts: string[] = []
  let depth = 0
  let current = ''
  for (const char of match[1]) {
    if (char === '(') depth += 1
    else if (char === ')') depth -= 1
    if (char === ',' && depth === 0) {
      parts.push(current)
      current = ''
    } else {
      current += char
    }
  }
  parts.push(current)
  return parts
    .map((part) => part.trim().split(/\s+/)[0])
    .filter((name) => name && name !== 'none')
}

// Pairs where both halves are pure CSS. The collapse is not one of these: its
// height is measured and set inline by ComposerCollapse, because CSS alone
// cannot ease between two content-derived heights.
const STATE_MACHINES = [
  { resting: '.mila-composer-tint', active: ".mila-composer-tint[data-active='true']" },
  { resting: '.mila-toggle-pill', active: ".mila-toggle-pill[data-armed='true']" },
  { resting: '.mila-composer-collapse > *', active: ".mila-composer-collapse[data-open='true'] > *" },
]

describe('composer motion stylesheet', () => {
  it.each(STATE_MACHINES)('$resting declares both halves of its state machine', ({ resting, active }) => {
    const restingBody = ruleBody(resting)
    const activeBody = ruleBody(active)

    expect(restingBody, `${resting} is missing`).not.toBeNull()
    expect(activeBody, `${active} is missing — the resting state would never change`).not.toBeNull()

    // Every property the resting state promises to animate must actually be
    // changed by the active state, or the transition is animating nothing.
    const promised = transitionedProperties(restingBody as string)
    expect(promised.length, `${resting} declares no transition`).toBeGreaterThan(0)
    for (const property of promised) {
      expect(
        (activeBody as string).includes(`${property}:`),
        `${resting} transitions "${property}" but ${active} never sets it`,
      ).toBe(true)
    }
  })

  it('animates the collapse height and clips on the same element', () => {
    // The height itself comes from JS, but the transition and the clip must be
    // here and must be on the *same* element — put `overflow: hidden` on the
    // child instead and the child's own height is what gets clipped, so the
    // measurement it reports stops matching what is on screen.
    const body = ruleBody('.mila-composer-collapse')
    expect(body).toContain('transition: height')
    expect(body).toContain('overflow: hidden')
    expect(body).toContain('height: 0')
  })

  it('honours prefers-reduced-motion', () => {
    // A design-system requirement, and easy to lose when adding a class later.
    expect(css).toContain('prefers-reduced-motion: reduce')
    const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)', css.indexOf('.mila-composer-tint')))
    for (const className of ['.mila-composer-tint', '.mila-composer-collapse', '.mila-toggle-pill']) {
      expect(reduced, `${className} still animates under reduced motion`).toContain(className)
    }
  })
})
