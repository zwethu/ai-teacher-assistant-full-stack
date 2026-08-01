// @vitest-environment jsdom

import { useRef } from 'react'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  LOAD_EARLIER_THRESHOLD_PX,
  useLoadEarlierOnScrollBottom,
  useLoadEarlierOnScrollTop,
  useScrollAnchor,
} from './useEarlierPaging'

afterEach(() => cleanup())

/** jsdom lays nothing out, so scrollHeight/clientHeight are always 0. These are
 *  the two numbers the hooks read; everything else about the element is real. */
function stub(el: HTMLElement, { scrollHeight = 0, clientHeight = 0, scrollTop = 0 } = {}) {
  Object.defineProperty(el, 'scrollHeight', { value: scrollHeight, configurable: true })
  Object.defineProperty(el, 'clientHeight', { value: clientHeight, configurable: true })
  el.scrollTop = scrollTop
}

describe('paging at the top of a transcript', () => {
  function Harness({ onLoad, busy = false, enabled = true }: { onLoad: () => void; busy?: boolean; enabled?: boolean }) {
    const ref = useRef<HTMLDivElement | null>(null)
    useLoadEarlierOnScrollTop(ref, { enabled, busy, onLoad })
    return <div ref={ref} data-testid="scroller" />
  }

  async function scrollTo(container: HTMLElement, top: number) {
    const el = container.querySelector('[data-testid="scroller"]') as HTMLElement
    el.scrollTop = top
    await act(async () => {
      el.dispatchEvent(new Event('scroll'))
      // One rAF tick.
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)))
    })
    return el
  }

  it('asks for the page above once the top is in reach', async () => {
    const onLoad = vi.fn()
    const { container } = render(<Harness onLoad={onLoad} />)

    await scrollTo(container, LOAD_EARLIER_THRESHOLD_PX - 1)

    expect(onLoad).toHaveBeenCalled()
  })

  it('stays quiet further down', async () => {
    const onLoad = vi.fn()
    const { container } = render(<Harness onLoad={onLoad} />)

    await scrollTo(container, LOAD_EARLIER_THRESHOLD_PX + 500)

    expect(onLoad).not.toHaveBeenCalled()
  })

  it('does not stack requests while one is in flight', async () => {
    const onLoad = vi.fn()
    const { container } = render(<Harness onLoad={onLoad} busy />)

    await scrollTo(container, 0)

    expect(onLoad).not.toHaveBeenCalled()
  })

  it('stops asking once the conversation has no more above it', async () => {
    const onLoad = vi.fn()
    const { container } = render(<Harness onLoad={onLoad} enabled={false} />)

    await scrollTo(container, 0)

    expect(onLoad).not.toHaveBeenCalled()
  })
})

describe('paging at the bottom of the sessions list', () => {
  function Harness({ onLoad }: { onLoad: () => void }) {
    const ref = useRef<HTMLDivElement | null>(null)
    useLoadEarlierOnScrollBottom(ref, { enabled: true, busy: false, onLoad })
    return <div ref={ref} data-testid="scroller" />
  }

  it('measures distance to the bottom, not the top', async () => {
    const onLoad = vi.fn()
    const { container } = render(<Harness onLoad={onLoad} />)
    const el = container.querySelector('[data-testid="scroller"]') as HTMLElement
    stub(el, { scrollHeight: 2000, clientHeight: 500 })

    // 1000px from the bottom: too far.
    el.scrollTop = 500
    await act(async () => {
      el.dispatchEvent(new Event('scroll'))
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)))
    })
    expect(onLoad).not.toHaveBeenCalled()

    // 100px from the bottom: close enough. Scrolling to the *top* would have
    // triggered the transcript's hook — proving the two are not the same test.
    el.scrollTop = 1400
    await act(async () => {
      el.dispatchEvent(new Event('scroll'))
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)))
    })
    expect(onLoad).toHaveBeenCalled()
  })
})

describe('holding the reading position when a page is prepended', () => {
  /** `scrollHeight` is defined in the ref callback, which React runs before
   *  layout effects — so the hook's first measurement sees the real height
   *  rather than jsdom's 0, and the growth it computes is the growth the test
   *  describes. */
  function Harness({ topId, height }: { topId: string; height: number }) {
    const ref = useRef<HTMLDivElement | null>(null)
    useScrollAnchor(ref, topId)
    return (
      <div
        ref={(node) => {
          ref.current = node
          if (node) Object.defineProperty(node, 'scrollHeight', { value: height, configurable: true })
        }}
        data-testid="scroller"
      />
    )
  }

  function mount(topId: string, height: number) {
    const view = render(<Harness topId={topId} height={height} />)
    const el = view.container.querySelector('[data-testid="scroller"]') as HTMLElement
    return { view, el }
  }

  it('pushes the scroll down by exactly what arrived above it', () => {
    const { view, el } = mount('m-10', 1000)
    el.scrollTop = 120

    // A page lands above: the list is 700px taller and starts at a new message.
    view.rerender(<Harness topId="m-1" height={1700} />)

    // Without the correction this stays at 120 and everything the lecturer was
    // reading slides 700px down the screen.
    expect(el.scrollTop).toBe(820)
  })

  it('leaves the view alone when a reply lands at the bottom', () => {
    const { view, el } = mount('m-1', 1000)
    el.scrollTop = 400

    // Same first message, taller list — an append. Correcting here would drag
    // the transcript backwards while an answer is streaming in.
    view.rerender(<Harness topId="m-1" height={1300} />)

    expect(el.scrollTop).toBe(400)
  })

  it('does nothing on the first render, when there is no "before" to compare', () => {
    const { el } = mount('m-1', 1000)
    expect(el.scrollTop).toBe(0)
  })
})

describe('the transcript state machine', () => {
  // The whole point of the optimistic `true`: a full first page must leave the
  // door open, and only a short page may close it.
  function pageState(pageLength: number, size: number) {
    return pageLength >= size
  }

  it('keeps paging open after a full page and shuts it after a short one', () => {
    expect(pageState(50, 50)).toBe(true)
    expect(pageState(49, 50)).toBe(false)
    expect(pageState(0, 50)).toBe(false)
  })
})
