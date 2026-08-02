// @vitest-environment jsdom

import { readFileSync } from 'node:fs'

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { NumberField } from './NumberField'

afterEach(cleanup)

describe('NumberField', () => {
  /**
   * The native spinner is the operating system's: a grey two-tone box on
   * Windows, tiny blue triangles on macOS, and in Chrome it only appears on
   * hover — so half the time the field looks like a plain text box that
   * mysteriously rejects letters.
   */
  it('draws its own stepper rather than the platform\'s', () => {
    const { container } = render(<NumberField value={30} onChange={vi.fn()} />)
    const input = container.querySelector('input[type="number"]') as HTMLElement

    expect(input.className).toContain('[appearance:textfield]')
    expect(input.className).toContain('[&::-webkit-inner-spin-button]:appearance-none')
    expect(container.querySelectorAll('button')).toHaveLength(2)
  })

  /**
   * Solid triangles, not chevrons. An outlined arrowhead is the mark for "go
   * somewhere"; a filled triangle is the mark for "nudge this value", and it
   * is the shape a number field's stepper already is to anyone who has used
   * one.
   */
  it('uses the stepper\'s own symbol', () => {
    const { container } = render(<NumberField value={30} onChange={vi.fn()} />)
    const glyphs = container.querySelectorAll('button svg')
    expect(glyphs).toHaveLength(2)
    for (const glyph of glyphs) {
      expect(glyph.getAttribute('class')).toContain('fill-current')
      // A path, not a stroked polyline.
      expect(glyph.querySelector('path')?.getAttribute('d')).toBe('M5 0 10 6 0 6z')
    }
  })

  /**
   * The two arrows read as one stacked pair. Centring each in its own half of
   * the field pushed them to opposite ends with a gap down the middle, which
   * is not what a stepper looks like.
   */
  it('keeps the two arrows together rather than one per half', () => {
    const { container } = render(<NumberField value={30} onChange={vi.fn()} />)
    const [up, down] = [...container.querySelectorAll('button')]
    expect(up.className).toContain('items-end')
    expect(down.className).toContain('items-start')
  })

  it('steps the value, and stops at the bounds', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const { container } = render(
      <NumberField value={40} min={4} max={40} onChange={onChange} />,
    )
    const [up, down] = [...container.querySelectorAll('button')]

    // No jest-dom here, so this reads the attribute directly.
    expect(up.hasAttribute('disabled')).toBe(true)
    await user.click(down)
    expect(onChange).toHaveBeenCalledWith(39)
  })

  /**
   * A cleared field parses to NaN, and stepping up from that used to produce
   * NaN rather than the first legal value.
   */
  it('steps up from the floor when the field is empty', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const { container } = render(<NumberField value={NaN} min={4} onChange={onChange} />)

    await user.click(container.querySelectorAll('button')[0])
    expect(onChange).toHaveBeenCalledWith(5)
  })

  /** Games needs this: its pair count has its own valid range and hint. */
  it('carries the caller\'s invalid state and description', () => {
    const { container } = render(
      <NumberField value={99} invalid describedBy="hint-id" onChange={vi.fn()} />,
    )
    const input = container.querySelector('input') as HTMLElement
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(input.getAttribute('aria-describedby')).toBe('hint-id')
    expect(input.className).toContain('border-red-400')
  })

  it('labels itself when given a label', () => {
    render(<NumberField label="Number of pairs" value={30} onChange={vi.fn()} />)
    expect(screen.getByLabelText('Number of pairs')).toBeTruthy()
  })
})

describe('number fields across the app', () => {
  /**
   * Games was the last raw `type="number"` on the site, so it was the one
   * field still drawing the platform's spinner beside controls that draw ours.
   */
  it.each([
    ['Games', 'src/pages/Games.tsx'],
    ['Lesson Plans', 'src/pages/LessonPlans.tsx'],
    ['Assessments', 'src/pages/Assessments.tsx'],
  ])('%s uses the shared control', (_name, path) => {
    const source = readFileSync(path, 'utf8')
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')

    expect(source).toContain('NumberField')
    expect(source).not.toMatch(/type="number"/)
  })
})
