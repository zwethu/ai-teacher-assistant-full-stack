import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

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

  it('leaves faster than it arrives', () => {
    const entry = Number(/transition:[^;]*?(\d+)ms/s.exec(resting())?.[1])
    const exit = Number(/transition-duration:\s*(\d+)ms/.exec(leaving())?.[1])

    expect(exit).toBeLessThan(entry)
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
 * The live working note has no ambient loop, on purpose. Notes arrive often
 * enough that the per-note transition already carries "still working", and the
 * loop it replaced dimmed the sentence to 2.36:1 against the transcript's wash
 * for half of every cycle.
 */
describe('the working note', () => {
  it('has no ambient loop of its own', () => {
    expect(css).not.toMatch(/@keyframes mila-live-text/)
    expect(css).not.toMatch(/\.mila-live-text\s*\{/)
  })

  it('still animates each new note as it arrives', () => {
    // The one motion left, and the only one needed: it replays on every note.
    expect(block('.mila-thought-swap')).toMatch(/animation:/)
    expect(css).toMatch(/@keyframes mila-thought-swap/)
  })

  it('does not dim the text it is drawing attention to', () => {
    // The retired loop's trough. Whatever replaces this must not reintroduce it.
    expect(block('@keyframes mila-thought-swap')).not.toMatch(/opacity:\s*0\.6/)
  })
})
