// @vitest-environment jsdom

import { readFileSync } from 'node:fs'

import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Collapse } from './Collapse'

const css = readFileSync('src/index.css', 'utf8')

afterEach(cleanup)

describe('Collapse', () => {
  /**
   * The forms did this with a bare `{open && <div>…</div>}`, so a block of
   * fields appeared and vanished between frames and everything below jumped by
   * however tall it was — most of a screen for "Show optional details".
   */
  it('eases its height rather than appearing between frames', () => {
    const { container, rerender } = render(
      <Collapse open={false}>
        <p>optional</p>
      </Collapse>,
    )
    const box = container.querySelector('.mila-collapse') as HTMLElement
    expect(box.hasAttribute('data-open')).toBe(false)

    rerender(
      <Collapse open>
        <p>optional</p>
      </Collapse>,
    )
    expect(box.getAttribute('data-open')).toBe('true')

    // The height itself is CSS, and jsdom applies no stylesheet.
    expect(css).toMatch(/\.mila-collapse\s*\{[^}]*grid-template-rows:\s*0fr/)
    expect(css).toMatch(/\.mila-collapse\[data-open='true'\]\s*\{[^}]*grid-template-rows:\s*1fr/)
    expect(css).toMatch(/\.mila-collapse\s*\{[^}]*transition:[^}]*grid-template-rows/)
  })

  /**
   * Children stay mounted: they hold form state, and unmounting would clear a
   * field the lecturer filled in before collapsing the section — and leave
   * nothing to animate shut.
   */
  it('keeps its children through a close', () => {
    const { rerender } = render(
      <Collapse open>
        <input aria-label="Time limit" defaultValue="30" />
      </Collapse>,
    )
    rerender(
      <Collapse open={false}>
        <input aria-label="Time limit" defaultValue="30" />
      </Collapse>,
    )
    expect(screen.getByLabelText('Time limit')).toBeTruthy()
  })

  /**
   * Which is exactly why it must be inert. `aria-hidden` alone would hide a
   * mounted field from a screen reader while leaving it in the tab order —
   * worse than either, because Tab would land on a control nobody can see.
   */
  it('puts a closed section out of reach, not just out of sight', () => {
    const { container, rerender } = render(
      <Collapse open={false}>
        <input aria-label="Time limit" />
      </Collapse>,
    )
    const box = container.querySelector('.mila-collapse') as HTMLElement
    expect(box.hasAttribute('inert')).toBe(true)

    rerender(
      <Collapse open>
        <input aria-label="Time limit" />
      </Collapse>,
    )
    expect(box.hasAttribute('inert')).toBe(false)

    /* The attribute, not the resulting tab order: jsdom parses `inert` but
       implements none of its focus semantics, so tabbing here would walk
       straight into the field and prove nothing about a real browser. */
  })

  /**
   * The collapsing box has to clip, or a closed section spills its contents.
   * An *open* one must not: these are form fields, and a focus ring or a date
   * picker opening upward would be cut off at the boundary.
   */
  it('clips only while it is moving', () => {
    vi.useFakeTimers()
    try {
      const { container, rerender } = render(
        <Collapse open={false}>
          <p>x</p>
        </Collapse>,
      )
      const box = container.querySelector('.mila-collapse') as HTMLElement
      expect(box.getAttribute('data-clipping')).toBe('true')

      rerender(
        <Collapse open>
          <p>x</p>
        </Collapse>,
      )
      // Still clipping while the height is on its way open.
      expect(box.getAttribute('data-clipping')).toBe('true')

      act(() => {
        vi.advanceTimersByTime(400)
      })
      expect(box.hasAttribute('data-clipping')).toBe(false)
      expect(css).toMatch(/\.mila-collapse\[data-clipping='true'\] > \*\s*\{[^}]*overflow:\s*hidden/)
    } finally {
      vi.useRealTimers()
    }
  })

  /**
   * Safe to switch off outright, unlike the step rows: `data-open` carries the
   * state rather than the animation, so a closed section stays closed and an
   * open one stays open — instantly.
   */
  it('degrades to an instant open under reduced motion', () => {
    /* Every reduced-motion block, not the first — the stylesheet has three,
       and brace-matched rather than regex-matched because they nest, so a lazy
       pattern stops at the first rule inside one and would pass on whatever
       happened to follow. */
    const blocks: string[] = []
    for (let at = css.indexOf('@media (prefers-reduced-motion: reduce)'); at > -1; ) {
      let depth = 0
      let end = at
      for (let i = css.indexOf('{', at); i < css.length; i += 1) {
        if (css[i] === '{') depth += 1
        else if (css[i] === '}') {
          depth -= 1
          if (depth === 0) {
            end = i
            break
          }
        }
      }
      blocks.push(css.slice(at, end))
      at = css.indexOf('@media (prefers-reduced-motion: reduce)', end)
    }

    expect(blocks.length).toBeGreaterThan(0)
    expect(blocks.some((block) => block.includes('.mila-collapse'))).toBe(true)
  })
})
