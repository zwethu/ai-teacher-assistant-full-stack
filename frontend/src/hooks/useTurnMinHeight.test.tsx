// @vitest-environment jsdom

import { useRef } from 'react'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { TURN_TOP_GAP_PX, useTurnMinHeight } from './useTurnMinHeight'

/**
 * The floor's job is to make the newest turn's box a fixed height, so a step
 * arriving or collapsing inside it cannot change the document's height and
 * therefore cannot move the conversation. What matters here is *what it
 * measures*: the scroll container, never the turn — measuring the turn is what
 * made the previous attempt lag a frame behind every step.
 */
let notify: (() => void) | null = null
let observed: string[] = []

class FakeResizeObserver {
  constructor(callback: () => void) {
    notify = callback
  }
  observe(target: Element) {
    observed.push((target as HTMLElement).dataset.role || 'unknown')
  }
  disconnect() {
    notify = null
  }
}

beforeEach(() => {
  notify = null
  observed = []
  ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = FakeResizeObserver
})
afterEach(() => {
  cleanup()
  delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver
})

function Harness({
  viewport,
  bottomInset,
  trailing = 0,
}: {
  viewport: number
  bottomInset: number
  /** Padding between the turn's bottom edge and the end of the content. */
  trailing?: number
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const contentRef = useRef<HTMLDivElement | null>(null)
  const turnRef = useRef<HTMLDivElement | null>(null)
  const height = useTurnMinHeight({ scrollRef, contentRef, turnRef, bottomInset })
  return (
    <div
      data-role="scroller"
      ref={(node) => {
        scrollRef.current = node
        if (node) Object.defineProperty(node, 'clientHeight', { value: viewport, configurable: true })
      }}
    >
      <div
        ref={(node) => {
          contentRef.current = node
          if (node) node.getBoundingClientRect = () => ({ bottom: trailing, top: 0 }) as DOMRect
        }}
      >
        <div
          data-testid="turn"
          data-role="turn"
          ref={(node) => {
            turnRef.current = node
            if (node) node.getBoundingClientRect = () => ({ bottom: 0, top: 0 }) as DOMRect
          }}
          style={{ minHeight: height }}
        />
      </div>
    </div>
  )
}

const floorOf = (container: HTMLElement) =>
  (container.querySelector('[data-testid="turn"]') as HTMLElement).style.minHeight

describe('flooring the newest turn', () => {
  it('reserves the viewport, less what the composer covers', () => {
    const { container } = render(<Harness viewport={800} bottomInset={100} />)

    expect(floorOf(container)).toBe(`${800 - 100 - TURN_TOP_GAP_PX}px`)
  })

  it('leaves a gap so the turn clears the header', () => {
    // The earlier spacer over-reserved and scrolled the lecturer's own message
    // up underneath the header, clipping it.
    const { container } = render(<Harness viewport={800} bottomInset={0} />)

    expect(Number.parseInt(floorOf(container), 10)).toBeLessThan(800)
  })

  it('watches the scroll container, not the turn', () => {
    // The whole point. Observing the turn means every step re-measures, and the
    // page moves for the frame before the new value lands.
    render(<Harness viewport={800} bottomInset={100} />)

    expect(observed).toEqual(['scroller'])
    expect(observed).not.toContain('turn')
  })

  it('follows the viewport when the window or composer resizes', () => {
    const { container, rerender } = render(<Harness viewport={800} bottomInset={100} />)
    expect(floorOf(container)).toBe(`${800 - 100 - TURN_TOP_GAP_PX}px`)

    rerender(<Harness viewport={600} bottomInset={100} />)
    act(() => notify?.())

    expect(floorOf(container)).toBe(`${600 - 100 - TURN_TOP_GAP_PX}px`)
  })

  it('subtracts whatever padding sits below the turn', () => {
    // Missing this put the lecturer's own message 40px above the top of the
    // viewport, hard against the header.
    const { container } = render(<Harness viewport={800} bottomInset={100} trailing={48} />)

    expect(floorOf(container)).toBe(`${800 - 100 - 48 - TURN_TOP_GAP_PX}px`)
  })

  it('never goes negative on a viewport smaller than the composer', () => {
    const { container } = render(<Harness viewport={40} bottomInset={200} />)

    expect(floorOf(container)).toBe('0px')
  })
})
