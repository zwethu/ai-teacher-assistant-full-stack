import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { LANE_SWAP_MS } from './StepsPanel'

/**
 * Step rows are the most interruptible thing in the app: with parallel tool
 * calls several arrive and settle at once, and the run can end while one is
 * still opening. Everything asserted here exists because an earlier keyframe
 * version got one of them wrong.
 *
 * jsdom applies no stylesheet, so the stylesheet is the only place to check it.
 */

const css = readFileSync(new URL('../../../../index.css', import.meta.url), 'utf8')

/** Body of the rule whose selector is exactly `selector`. */
function block(selector: string): string {
  const lines = css.split('\n')
  const start = lines.findIndex((line) => line.trim() === `${selector} {`)
  if (start === -1) throw new Error(`no rule for ${selector}`)
  let depth = 0
  for (let i = start; i < lines.length; i += 1) {
    depth += (lines[i].match(/\{/g) || []).length
    depth -= (lines[i].match(/\}/g) || []).length
    if (depth === 0) return lines.slice(start + 1, i).join('\n')
  }
  throw new Error(`unterminated rule for ${selector}`)
}

const resting = () => block('.mila-step-row')
const leaving = () => block(".mila-step-row[data-leaving='true']")
const laneIn = () => block('.mila-lane__in')
const laneOut = () => block('.mila-lane__out')
const partsIn = () => block('.mila-lane__in [data-step-head] > *')
const partsOut = () => block('.mila-lane__out [data-step-head] > *')

/** Every regex metacharacter a CSS selector can legally contain. */
const escapeRe = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Every `@starting-style` body for a selector, concatenated. */
function startingStyle(selector: string): string {
  const pattern = new RegExp(
    `@starting-style\\s*\\{[^]*?${escapeRe(selector)}\\s*\\{([^}]*)\\}`,
    'g',
  )
  const found = [...css.matchAll(pattern)].map((match) => match[1])
  if (found.length === 0) throw new Error(`no @starting-style for ${selector}`)
  return found.join('\n')
}

/**
 * Body of a rule found by its *first* selector.
 *
 * `block` matches a whole line, which a grouped selector spread over several
 * lines never is — and the stagger deliberately shares one rule between the
 * arriving and departing sides so they cannot drift apart.
 */
function groupedBlock(firstSelector: string): string {
  const match = new RegExp(`${escapeRe(firstSelector)},[^{]*\\{([^}]*)\\}`).exec(css)
  if (!match) throw new Error(`no grouped rule starting at ${firstSelector}`)
  return match[1]
}

const durationsIn = (body: string) =>
  [...body.matchAll(/(\d+)ms/g)].map((match) => Number(match[1]))

/**
 * A lane changing hands — one step finishing, the next taking its place. This
 * is the most-seen motion in a run: once per step, several times a minute.
 */
describe('the lane crossfade', () => {
  it('moves as well as fades, so a swap is not a cut', () => {
    // Opacity alone, between two lines of text in the same place, reads as a
    // hard swap at any duration short enough to be worth having. The two
    // directions carry it differently — the arrival slides in, the departure
    // collapses in place — so this only asks that each one transforms at all.
    expect(startingStyle('.mila-lane__in [data-step-head] > *')).toMatch(/transform:\s*\w/)
    expect(partsOut()).toMatch(/transform:\s*\w/)
  })

  /**
   * Sideways, not up — and this is a bug fix, not a preference.
   *
   * The first version lifted the outgoing parts 8px. Rows sit 6px apart
   * (`pb-1.5`), so that carried the leaving step two pixels into the row above
   * while it was still part-opaque, over a line the lecturer was reading.
   * Vertical motion in a vertical list has nowhere to go that is not another
   * row's space; a row has width to spare and none above it.
   */
  /**
   * The exit collapses in place, and this is a bug fix twice over.
   *
   * Two translated exits went wrong the same way. Up by 8px carried the
   * leaving step into the row above — rows sit 6px apart (`pb-1.5`), so it
   * overlapped a line being read. Left by 10px put it under the lane's clip
   * and cut the content against the edge on its way out. A scale has nowhere
   * to go but inward: it cannot reach a neighbour and cannot be clipped, and
   * it needs no arithmetic against the row gap to stay correct.
   */
  it('pops the old step out in place rather than moving it anywhere', () => {
    expect(partsOut()).toMatch(/transform:\s*scale\(/)
    // Any translate here is a return to one of the two earlier bugs.
    expect(partsOut()).not.toMatch(/translate/)
  })

  /**
   * The departure has a from-state, without which it never animated at all.
   *
   * The outgoing row is a newly mounted copy — it comes into existence already
   * leaving. A transition needs two values and a fresh element has only the one
   * it was born with, so these parts appeared at their end transform on the
   * first frame and sat there while the wrapper faded around them. Measured in
   * a headless browser: their width went 348.5 → 348.5 across the whole exit
   * before this, and 348.5 → 209.1 after.
   */
  it('gives the leaving parts something to animate from', () => {
    expect(startingStyle('.mila-lane__out [data-step-head] > *')).toMatch(/transform:\s*none/)
  })

  /**
   * One part at a time. 30ms over a 200ms exit read as everything going at
   * once with a slight blur, which is the all-together this exists not to be.
   */
  it('pops them one by one rather than together', () => {
    const second = groupedBlock('.mila-lane__in [data-step-head] > :nth-child(2)')
    const third = groupedBlock('.mila-lane__in [data-step-head] > :nth-child(3)')
    const delay = (body: string) => Number(/--mila-part-delay:\s*(\d+)ms/.exec(body)?.[1])

    expect(delay(second)).toBeGreaterThanOrEqual(45)
    expect(delay(third)).toBe(delay(second) * 2)
    // The tail still lands inside the motion it belongs to.
    expect(delay(third)).toBeLessThan(Math.max(...durationsIn(partsOut())))
  })

  /**
   * The row's parts move one after another, so the swap reads as a wave
   * crossing it rather than as one picture replacing another. Icon, title,
   * badge — the same order both ways, or it is two waves meeting in the
   * middle instead of one passing through.
   */
  it('sweeps its parts one by one, in the same order both ways', () => {
    const delayFor = (nth: number) =>
      groupedBlock(`.mila-lane__in [data-step-head] > :nth-child(${nth})`)

    expect(delayFor(2)).toMatch(/--mila-part-delay:\s*45ms/)
    expect(delayFor(3)).toMatch(/--mila-part-delay:\s*90ms/)
    // Both directions share the rule, so they cannot drift apart.
    expect(partsIn()).toMatch(/var\(--mila-part-delay/)
    expect(partsOut()).toMatch(/var\(--mila-part-delay/)
  })

  /**
   * Opacity on the wrapper, transform on the parts — never both. Fading a part
   * inside a fading card multiplies the two, so a part at 50% inside a card at
   * 50% is a quarter opaque a third of the way through.
   */
  it('splits opacity from movement so the two do not compound', () => {
    expect(laneIn()).toMatch(/opacity/)
    expect(laneIn()).not.toMatch(/transform/)
    expect(partsIn()).toMatch(/transform/)
    expect(partsIn()).not.toMatch(/opacity/)
  })

  /** The card must not finish fading while a part of it is still travelling. */
  it('fades the card across the whole sweep, stagger included', () => {
    const sweepOut = Math.max(...durationsIn(partsOut())) + 60
    expect(Math.max(...durationsIn(laneOut()))).toBeGreaterThanOrEqual(sweepOut)

    const sweepIn = Math.max(...durationsIn(partsIn())) + 60
    expect(Math.max(...durationsIn(laneIn()))).toBeGreaterThanOrEqual(sweepIn)
  })

  it('arrives slower than it leaves, and on the opposite curve', () => {
    const [inOpacity] = durationsIn(laneIn())
    const [outOpacity] = durationsIn(laneOut())

    expect(outOpacity).toBeLessThan(inOpacity)
    // Ease-out in, ease-in out: the new step settles, the old accelerates off.
    expect(laneIn()).toMatch(/cubic-bezier\(0\.16, 1, 0\.3, 1\)/)
    expect(laneOut()).toMatch(/cubic-bezier\(0\.4, 0, 1, 1\)/)
  })

  /**
   * The one way a fade really does become an instant disappearance: unmount
   * the element partway through it. `LANE_SWAP_MS` is the timer that holds the
   * outgoing row, so it has to outlast the animation the stylesheet gives it.
   */
  it('holds the outgoing step until its animation has finished', () => {
    const longest = Math.max(
      Math.max(...durationsIn(laneOut())),
      Math.max(...durationsIn(partsOut())) + 60,
    )
    expect(longest).toBeLessThanOrEqual(LANE_SWAP_MS)
  })

  it('transitions rather than running keyframes, like the row itself', () => {
    // Same reason: a lane can change hands again while the last swap is still
    // playing, and a keyframe would restart from its own `from` frame.
    expect(laneIn()).toMatch(/transition:/)
    expect(laneIn()).not.toMatch(/animation:/)
    expect(laneOut()).not.toMatch(/animation:/)
  })
})

describe('step row motion', () => {
  it('transitions rather than running keyframes', () => {
    // A keyframe restarts from its own `from` frame, so a row told to leave
    // 100ms into its entrance snapped to full height before collapsing. A
    // transition retargets from wherever the value actually is.
    expect(resting()).toMatch(/transition:/)
    expect(css).not.toMatch(/@keyframes mila-step-(in|out)/)
  })

  it('opens the row height, not just its opacity', () => {
    // Animating opacity alone let the box snap to full height in one frame
    // while the contents faded in prettily on top of the jump.
    expect(resting()).toMatch(/transition:[^;]*grid-template-rows/s)
    expect(leaving()).toMatch(/grid-template-rows:\s*0fr/)
  })

  it('rests in the visible state', () => {
    // This is what makes reduced motion safe. Resting collapsed means removing
    // the motion removes the content, which is exactly what happened before.
    expect(resting()).toMatch(/grid-template-rows:\s*1fr/)
    expect(resting()).toMatch(/opacity:\s*1/)
  })

  it('supplies the entry from-state without a second class', () => {
    expect(css).toMatch(/@starting-style\s*\{\s*\.mila-step-row\s*\{/)
  })

  /**
   * Deliberately *not* "leaves faster than it arrives", which is what this
   * asserted before and is the right instinct for a lone row.
   *
   * These rows overlap. A lane closing while another opens changes the
   * container's height by −h·X(t) and +h·E(t) on the same frame, and only
   * identical curves make those cancel. Evaluating the old pairing — 240ms in,
   * 180ms out, same ease-out — put the container at 0.891 of a row 30ms in,
   * and at 0.174 once the arriving lane carried the fan-out stagger. Matched,
   * the sum is a flat 1.000 for the whole transition.
   *
   * So the exit must not restate a duration at all: it inherits the entrance's.
   */
  it('leaves on exactly the curve and duration it arrived on', () => {
    const entry = Number(/transition:[^;]*?(\d+)ms/s.exec(resting())?.[1])

    expect(leaving()).not.toMatch(/transition-duration/)
    expect(leaving()).not.toMatch(/transition-timing-function/)
    // The ceiling for UI motion, for a row seen several times per run.
    expect(entry).toBeLessThanOrEqual(250)
  })

  it('drops the stagger on the way out', () => {
    // A departure is not a cascade, and a delay would hold the space open
    // after the row had visibly gone.
    expect(leaving()).toMatch(/transition-delay:\s*0ms/)
  })

  it('moves height and opacity, and nothing else', () => {
    // With the height easing open, a translate on top overshoots the box the
    // row is growing into — and it stopped the exit being an exact mirror.
    expect(resting()).not.toMatch(/transform/)
    expect(leaving()).not.toMatch(/transform/)
  })

  it('stays visible for reduced motion', () => {
    const reduced = css.slice(
      css.indexOf('@media (prefers-reduced-motion: reduce)', css.indexOf('.mila-step-row')),
    )
    // The rule groups the step row with the card entry, so match the whole
    // selector list rather than assuming it stands alone.
    const rule = /\.mila-step-row[^{]*\{([^}]*)\}/.exec(reduced)?.[1] ?? ''

    expect(rule).toMatch(/transition:\s*none/)
    // And nothing that would collapse it: the resting state does the work.
    expect(rule).not.toMatch(/0fr/)
  })

  it('clips the child, or the collapse shows its overflow', () => {
    const clip = block('.mila-step-row > *')

    expect(clip).toMatch(/overflow:\s*hidden/)
    expect(clip).toMatch(/min-height:\s*0/)
  })
})

/**
 * The cards that arrive after an answer has settled: the outline waiting for
 * approval, the generated preview, and the export controls that turn it into
 * real Drive files. Their metadata lands a beat after the text, so without an
 * entry they appear at full size and read as a glitch.
 */
describe('cards arriving after the answer', () => {
  const card = () => block('.mila-card-in')

  it('eases in rather than appearing at full size', () => {
    expect(card()).toMatch(/transition:[^;]*opacity/s)
    expect(card()).toMatch(/transition:[^;]*transform/s)
    expect(css).toMatch(/@starting-style\s*\{\s*\.mila-card-in\s*\{/)
  })

  it('rests visible, so reduced motion can just stop the movement', () => {
    expect(card()).toMatch(/opacity:\s*1/)
    expect(card()).toMatch(/transform:\s*none/)

    const reduced = css.slice(
      css.indexOf('@media (prefers-reduced-motion: reduce)', css.indexOf('.mila-card-in')),
    )
    expect(reduced).toMatch(/\.mila-card-in[^{]*\{[^}]*transition:\s*none/)
  })

  it('does not animate layout, unlike a step row', () => {
    // A card is appended with nothing below it to displace and the turn's floor
    // absorbs its height, so there is no jump to ease — and staying on
    // compositor properties keeps its shadow out of a clip.
    expect(card()).not.toMatch(/grid-template-rows/)
  })

  it('carries its own hover tint instead of a transition-colors utility', () => {
    // `transition-colors` sets `transition-property` outright, which would drop
    // the opacity and transform transitions declared above it.
    expect(card()).toMatch(/background-color/)
  })
})

/**
 * The live working note loops while the agent is thinking. It did not always:
 * the first version pulsed the whole line's opacity and dimmed it to 2.36:1
 * against the transcript's wash for half of every cycle, so it was removed
 * outright. The loop is back by request, built the other way round — the text
 * rests at full contrast and a *deeper* band travels through it — and what is
 * asserted here is that constraint, not the absence of motion.
 */

/** Every stop colour named in a `linear-gradient(...)`, as token names. */
function gradientTokens(rule: string): string[] {
  const gradient = /background-image:\s*linear-gradient\(([^;]*)\);/s.exec(rule)?.[1] ?? ''
  return Array.from(gradient.matchAll(/var\(--([a-z0-9-]+)\)/g), (match) => match[1])
}

/** The design system's own palette, which is where these tokens resolve. */
const tokens = readFileSync(
  new URL('../../../../design-system/tokens/colors.css', import.meta.url),
  'utf8',
)
const hexFor = (token: string) =>
  new RegExp(`--${token}:\\s*(#[0-9a-f]{6})`, 'i').exec(tokens)?.[1] ?? ''

function relativeLuminance(hex: string) {
  const channels = [1, 3, 5]
    .map((index) => parseInt(hex.slice(index, index + 2), 16) / 255)
    .map((value) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4))
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
}

function contrast(a: string, b: string) {
  const [lighter, darker] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x)
  return (lighter + 0.05) / (darker + 0.05)
}

/** Every rule written for `selector`, in source order. */
function blocks(selector: string): string[] {
  const lines = css.split('\n')
  const found: string[] = []
  lines.forEach((line, start) => {
    if (line.trim() !== `${selector} {`) return
    let depth = 0
    for (let i = start; i < lines.length; i += 1) {
      depth += (lines[i].match(/\{/g) || []).length
      depth -= (lines[i].match(/\}/g) || []).length
      if (depth === 0) return found.push(lines.slice(start + 1, i).join('\n'))
    }
  })
  return found
}

/** The rule that carries the sweep — the one behind the `@supports` gate, not
 *  the bare rule above it that only holds the per-note arrival, and not the
 *  reduced-motion rule below that undoes both. */
const swept = () =>
  blocks('.mila-thought-swap').find((rule) => rule.includes('background-clip:')) ?? ''

describe('the working note', () => {
  it('loops for as long as it is on screen', () => {
    expect(css).toMatch(/@keyframes mila-thought-sweep/)
    expect(swept()).toMatch(/mila-thought-sweep[^;]*infinite/)
  })

  it('still animates each new note as it arrives', () => {
    // The arrival and the loop coexist on one element, so they have to share a
    // single `animation` shorthand — declaring the second in its own rule would
    // silently replace the first.
    expect(block('.mila-thought-swap')).toMatch(/animation:/)
    expect(css).toMatch(/@keyframes mila-thought-swap/)
    expect(swept()).toMatch(/mila-thought-swap 380ms/)
  })

  /**
   * The structural half of the guarantee. A loop that only moves the gradient
   * cannot dim anything, whatever colours it is given — which is why the
   * keyframes are allowed to touch exactly one property.
   */
  it('loops without touching opacity, filter or colour', () => {
    const frames = block('@keyframes mila-thought-sweep')
    expect(frames).toMatch(/background-position/)
    expect(frames).not.toMatch(/opacity|filter|[^-]color:/)
  })

  /**
   * The colour half. Every stop the band sweeps through is measured against the
   * transcript's own wash, so a future tweak to a "nicer" lighter violet fails
   * here rather than quietly recreating the defect that got the first loop
   * removed. 4.5:1 is AA for text this size.
   */
  it('sweeps only through colours that stay legible on the transcript', () => {
    const wash = hexFor('academic-bg')
    const stops = gradientTokens(swept())
    expect(stops.length).toBeGreaterThan(2)

    for (const stop of stops) {
      const hex = hexFor(stop)
      expect(hex, `--${stop} is not a design-system colour`).toMatch(/^#[0-9a-f]{6}$/i)
      expect(contrast(hex, wash), `--${stop} on the transcript wash`).toBeGreaterThanOrEqual(4.5)
    }
  })

  /**
   * Gold is the brand accent and the one colour that cannot be a glyph here:
   * 1.43:1 on this wash. It stays on the mark beside the line.
   */
  it('keeps gold off the glyphs', () => {
    expect(gradientTokens(swept()).some((token) => token.startsWith('gold'))).toBe(false)
  })

  /**
   * The flash is *in* the letters, and the only thing that makes it so is that
   * nothing is painted behind them. A first version put a soft gold glow on a
   * `::before` travelling in phase with the band; clipped to a rounded box
   * rather than to the glyphs, it read as a highlighter pen dragged across the
   * sentence — the exact effect this is not meant to be.
   */
  it('paints nothing behind the text', () => {
    expect(swept()).toMatch(/background-clip: text/)
    expect(css).not.toMatch(/\.mila-thought-swap::(before|after)/)
  })

  it('hands the glyphs back to a solid colour under reduced motion', () => {
    // Switching the animation off alone would leave the note painted by a
    // gradient it can no longer move.
    const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'))
    expect(reduced).toMatch(/\.mila-thought-swap \{\s*background-image: none;\s*color: inherit;/)
  })
})
