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

/** Property names a rule actually declares. Anchored to the start of a
 *  declaration so `background-color:` is not mistaken for `color:`. */
function declaredProperties(body: string): string[] {
  return Array.from(body.matchAll(/(?:^|[;{])\s*(-?[a-z][a-z-]*)\s*:/gm), (match) => match[1])
}

// Pairs where both halves are pure CSS. The collapse is not one of these: its
// height is measured and set inline by ComposerCollapse, because CSS alone
// cannot ease between two content-derived heights.
const STATE_MACHINES = [
  { resting: '.mila-composer-tint', active: ".mila-composer-tint[data-active='true']" },
  {
    resting: '.mila-toggle-pill',
    active: ".mila-toggle-pill[data-armed='true']",
    // The pill's text colour is a React className (`text-violet-900` /
    // `text-slate-600`), so the stylesheet transitions a property it never
    // sets. That is deliberate, and the only such case.
    setInJsx: ['color'],
  },
  { resting: '.mila-composer-collapse > *', active: ".mila-composer-collapse[data-open='true'] > *" },
]

/** Never worth transitioning, or transitioned via their unprefixed twin. */
const NOT_ANIMATED = ['transition', 'transform-origin']

describe('composer motion stylesheet', () => {
  it.each(STATE_MACHINES)(
    '$resting declares both halves of its state machine',
    ({ resting, active, setInJsx = [] }) => {
      const restingBody = ruleBody(resting)
      const activeBody = ruleBody(active)

      expect(restingBody, `${resting} is missing`).not.toBeNull()
      expect(activeBody, `${active} is missing — the resting state would never change`).not.toBeNull()

      const promised = transitionedProperties(restingBody as string)
      const changed = declaredProperties(activeBody as string)
      expect(promised.length, `${resting} declares no transition`).toBeGreaterThan(0)

      // Every property the resting state promises to animate must actually be
      // changed by the active state, or the transition is animating nothing.
      for (const property of promised) {
        if (setInJsx.includes(property)) continue
        expect(
          changed.includes(property),
          `${resting} transitions "${property}" but ${active} never sets it`,
        ).toBe(true)
      }

      // And the converse, which is the half that bites: a property the active
      // state changes but the resting state never promised snaps instantly
      // while everything beside it eases. The web-search shell's blur did
      // exactly that — it popped on and off around a 240ms tint.
      for (const property of changed) {
        if (NOT_ANIMATED.includes(property) || property.startsWith('-webkit-')) continue
        expect(
          promised.includes(property),
          `${active} changes "${property}" but ${resting} never transitions it — it will snap`,
        ).toBe(true)
      }
    },
  )

  it('rounds the web-search frost to the shell it sits inside', () => {
    // A backdrop-filter paints its own layer, and an ancestor's border-radius
    // does not clip it without `overflow: hidden`. Shipped square, the frost
    // showed its corners past the shell's rounded edge as a rectangle sticking
    // out of the composer. Derived from the shell rather than hardcoded, so
    // restyling the shell fails here instead of leaving the frost behind.
    const shell = ruleBody('.mila-composer-tint') as string
    const armed = ruleBody(".mila-composer-tint[data-active='true']") as string
    const frost = ruleBody(".mila-composer-collapse[data-region='web-search']")

    expect(frost, 'the web-search frost rule is missing').not.toBeNull()
    expect(frost).toContain('backdrop-filter:')

    const shellRadius = Number(/border-radius:\s*(\d+)px/.exec(shell)?.[1])
    const armedPadding = Number(/padding:\s*(\d+)px/.exec(armed)?.[1])
    expect(frost).toContain(`border-radius: ${shellRadius - armedPadding}px`)
  })

  it('keeps the frost off the element that carries the entrance transform', () => {
    // backdrop-filter and transform on one element make the browser sample the
    // backdrop in the untransformed space, which shows up as a frosted
    // rectangle offset from the thing it is meant to be frosting.
    const transformed = ruleBody('.mila-composer-collapse > *') as string
    expect(transformed).toContain('transform:')
    expect(transformed).not.toContain('backdrop-filter')
  })

  it('keeps the composer surface opaque and blurred on its own terms', () => {
    // `.maia-glass` ships unlayered from the design system, and an unlayered
    // rule beats every @layer — so an override written for the composer inside
    // `@layer utilities` loses silently. Column 0 is how this rule wins.
    expect(
      css.includes('\n.mila-composer-surface {'),
      '.mila-composer-surface must stay unlayered or the design system overrides it',
    ).toBe(true)

    const body = ruleBody('.mila-composer-surface') as string
    expect(body).toContain('backdrop-filter:')
    // 0.55 white with no blur behind it let the transcript read straight
    // through the composer; 0.75 is the design system's above-content token.
    expect(body).toContain('--surface-glass-strong')
  })

  it('never leaves an entrance animation filling forwards over that glass', () => {
    // A forwards fill keeps the animation applied to opacity/transform for the
    // life of the page, which makes the wrapper a backdrop root and leaves the
    // surface inside it with nothing to blur.
    const body = ruleBody('.chat-composer-enter') as string
    expect(body).toContain('backwards')
    expect(body).not.toMatch(/\bboth\b/)
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

  it('leaves the scrollbar gutter showing the page, not its own colour', () => {
    // Giving `::-webkit-scrollbar` a width makes Chromium treat it as a custom
    // scrollbar, and every part of it then paints a default colour unless told
    // otherwise. Styling only -track left the scrollbar box itself painting a
    // strip beside the page in a different shade.
    const parts = [
      /\*::-webkit-scrollbar \{[^}]*background:\s*transparent/s,
      /\*::-webkit-scrollbar-track,/,
      /\*::-webkit-scrollbar-track-piece,/,
      /\*::-webkit-scrollbar-corner/,
    ]
    for (const part of parts) {
      expect(part.test(css), `${part} is not transparent`).toBe(true)
    }
  })

  it('keeps the composer band clear of the transcript scrollbar', () => {
    // The band overlays the scrolling <main>, so at full width it frosted the
    // scrollbar thumb the moment it reached the bottom. `useScrollbarGutter`
    // measures the real width at runtime; this fallback only covers the frame
    // before that, so it should still match what Chromium will render.
    const fallback = /--chat-scrollbar-gutter:\s*(\d+)px/.exec(css)?.[1]
    const scrollbar = /\*::-webkit-scrollbar \{[^}]*width:\s*(\d+)px/s.exec(css)?.[1]

    expect(fallback, '--chat-scrollbar-gutter is missing').toBeDefined()
    expect(fallback, 'the fallback no longer matches the scrollbar width').toBe(scrollbar)
    expect(ruleBody('.mila-composer-floor')).toContain('right: var(--chat-scrollbar-gutter)')
  })

  it('writes -webkit-backdrop-filter before the standard property', () => {
    // Not cosmetic. The build minifier folds the pair down to one declaration
    // and keeps the *last* one, so `backdrop-filter` followed by the prefixed
    // twin shipped WebKit-only — every glass surface in the app rendered flat
    // in Firefox, which has no -webkit- alias for it. Standard last wins.
    const lines = css.split('\n')
    const wrongOrder = lines.filter(
      (line, index) =>
        /^\s*backdrop-filter:/.test(line) &&
        /^\s*-webkit-backdrop-filter:/.test(lines[index + 1] || ''),
    )
    expect(wrongOrder, 'the minifier will drop the standard property').toEqual([])
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
