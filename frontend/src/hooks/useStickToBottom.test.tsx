// @vitest-environment jsdom

import { useRef } from 'react'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { STICK_TO_BOTTOM_PX, useStickToBottom } from './useStickToBottom'

/**
 * jsdom ships no ResizeObserver, so the test owns one: it records what was
 * observed and exposes a trigger, which is exactly the granularity these tests
 * need — "the content changed size, what did the transcript do?"
 */
let resize: (() => void) | null = null

class FakeResizeObserver {
  constructor(callback: () => void) {
    resize = callback
  }
  observe() {}
  disconnect() {
    resize = null
  }
}

beforeEach(() => {
  resize = null
  ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = FakeResizeObserver
})

afterEach(() => {
  cleanup()
  delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver
})

function Harness({ scrollHeight, clientHeight }: { scrollHeight: number; clientHeight: number }) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const contentRef = useRef<HTMLDivElement | null>(null)
  useStickToBottom(scrollRef, contentRef)
  return (
    <div
      ref={(node) => {
        scrollRef.current = node
        if (!node) return
        Object.defineProperty(node, 'scrollHeight', { value: scrollHeight, configurable: true })
        Object.defineProperty(node, 'clientHeight', { value: clientHeight, configurable: true })
      }}
      data-testid="scroller"
    >
      <div ref={contentRef} />
    </div>
  )
}

function mount(scrollHeight = 2000, clientHeight = 500) {
  const view = render(<Harness scrollHeight={scrollHeight} clientHeight={clientHeight} />)
  const el = view.container.querySelector('[data-testid="scroller"]') as HTMLElement
  return { view, el }
}

/** Move the scroll and let the hook's listener record where we are. */
function scrollTo(el: HTMLElement, top: number) {
  act(() => {
    el.scrollTop = top
    el.dispatchEvent(new Event('scroll'))
  })
}

describe('following a growing transcript', () => {
  it('sticks to the bottom while the content grows', () => {
    const { el } = mount()
    scrollTo(el, 1500) // exactly at the bottom: 2000 - 1500 - 500 = 0

    act(() => resize?.())

    expect(el.scrollTop).toBe(2000)
  })

  it('still follows from just inside the threshold', () => {
    const { el } = mount()
    scrollTo(el, 1500 - (STICK_TO_BOTTOM_PX - 1))

    act(() => resize?.())

    expect(el.scrollTop).toBe(2000)
  })

  it('lets go once the lecturer scrolls up to read', () => {
    const { el } = mount()
    // Reading back through the conversation. The old event-driven scroll was
    // unconditional and yanked them to the end on every streamed token.
    scrollTo(el, 200)

    act(() => resize?.())

    expect(el.scrollTop).toBe(200)
  })

  it('starts pinned, so opening a chat lands on the newest message', () => {
    const { el } = mount()

    // No scroll event yet — nothing has said otherwise.
    act(() => resize?.())

    expect(el.scrollTop).toBe(2000)
  })

  it('follows again once they scroll back down', () => {
    const { el } = mount()
    scrollTo(el, 200)
    act(() => resize?.())
    expect(el.scrollTop).toBe(200)

    scrollTo(el, 1500)
    act(() => resize?.())
    expect(el.scrollTop).toBe(2000)
  })

  it('stops observing when the transcript unmounts', () => {
    const { view } = mount()
    expect(resize).not.toBeNull()

    view.unmount()

    expect(resize).toBeNull()
  })
})
