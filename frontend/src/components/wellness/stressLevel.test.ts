/**
 * Every colour the meter asks for has to exist.
 *
 * The fill is applied as `backgroundImage: linear-gradient(..., var(--x))`. A
 * CSS variable that was never defined does not throw and does not warn — the
 * gradient silently resolves to nothing and the bar renders as an empty track.
 * That failure looks exactly like "stress is 0", which is the one reading this
 * feature must never get wrong, so the token names are checked against the
 * stylesheet rather than trusted.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { LEVEL_FILL, LEVEL_TEXT, levelWord } from './stressLevel'

const TOKENS = readFileSync(
  fileURLToPath(new URL('../../design-system/tokens/colors.css', import.meta.url)),
  'utf8',
)

const LEVELS = ['low', 'medium', 'high', 'max'] as const

describe('stress level styling', () => {
  it('references only CSS variables the stylesheet defines', () => {
    const referenced = Object.values(LEVEL_FILL).flatMap((fill) =>
      [...fill.matchAll(/var\((--[\w-]+)\)/g)].map((m) => m[1]),
    )

    expect(referenced.length).toBe(8) // two stops per band
    for (const name of referenced) {
      expect(TOKENS, `${name} is used by the meter but not defined`).toContain(`${name}:`)
    }
  })

  it('gives every band its own depth and its own word colour', () => {
    expect(new Set(Object.values(LEVEL_FILL)).size).toBe(LEVELS.length)
    expect(new Set(Object.values(LEVEL_TEXT)).size).toBe(LEVELS.length)
  })

  it('names the bands the way the meter labels them', () => {
    expect(LEVELS.map(levelWord)).toEqual(['Low', 'Medium', 'High', 'Max'])
  })
})
