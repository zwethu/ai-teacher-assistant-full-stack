// @vitest-environment jsdom

import { useRef } from 'react'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { PopoverBoundary, useFlipPlacement } from './useFlipPlacement'

afterEach(cleanup)

/**
 * jsdom has no layout, so every rect is zeroes and every `scrollHeight` is 0.
 * These tests supply both, which is the whole input to the decision — the hook
 * is arithmetic over "where is the trigger" and "how tall does the panel want
 * to be", and that is exactly what is stubbed here.
 */
const VIEWPORT = 800

function place(triggerBottom: number, panelHeight: number) {
  let latest: { dropUp: boolean; maxHeight: number | undefined } = {
    dropUp: false,
    maxHeight: undefined,
  }

  function Harness() {
    const wrapRef = useRef<HTMLDivElement>(null)
    const panelRef = useRef<HTMLDivElement>(null)
    latest = useFlipPlacement(wrapRef, panelRef, true, { gap: 6, margin: 8 })
    return (
      <div>
        <div
          ref={(node) => {
            if (!node) return
            node.getBoundingClientRect = () =>
              ({ top: triggerBottom - 40, bottom: triggerBottom }) as DOMRect
            ;(wrapRef as { current: HTMLDivElement | null }).current = node
          }}
        />
        <div
          ref={(node) => {
            if (!node) return
            Object.defineProperty(node, 'scrollHeight', { value: panelHeight, configurable: true })
            ;(panelRef as { current: HTMLDivElement | null }).current = node
          }}
        />
      </div>
    )
  }

  render(<Harness />)
  return () => latest
}

beforeEach(() => {
  Object.defineProperty(window, 'innerHeight', { value: VIEWPORT, configurable: true })
})

describe('useFlipPlacement', () => {
  it('opens downward when there is room', () => {
    // 800 − 200 = 600 below, panel wants 400.
    const read = place(200, 400)
    expect(read().dropUp).toBe(false)
    expect(read().maxHeight).toBeUndefined()
  })

  it('flips up when the panel would not fit below', () => {
    // 100 below, 660 above.
    const read = place(700, 400)
    expect(read().dropUp).toBe(true)
    expect(read().maxHeight).toBeUndefined()
  })

  /**
   * The bug this replaced a constant to fix.
   *
   * The calendar assumed it was 380px tall and only reacted when the room
   * below fell under that. Adding the time picker took it past 460px, so with
   * ~416px below it saw room it did not have, did neither of the two things
   * that would have saved it, and ran off the bottom of the page under the
   * footer.
   *
   * Below is still the better side here — 416px against 316px above — so the
   * answer is not to flip but to cap. The guarantee is the same either way,
   * and it is the one the constant could not make: the panel never claims more
   * room than there is.
   */
  it('never overflows the viewport for a panel taller than the old constant', () => {
    const roomBelow = VIEWPORT - 370 - 6 - 8
    const read = place(370, 460)

    expect(read().dropUp).toBe(false)
    expect(read().maxHeight).toBe(roomBelow)
    expect(read().maxHeight!).toBeLessThanOrEqual(roomBelow)
  })

  it('caps the height when neither side can hold it', () => {
    // A short viewport with the trigger mid-screen: 400 below, 360 above.
    const read = place(386, 700)
    expect(read().dropUp).toBe(false)
    expect(read().maxHeight).toBe(800 - 386 - 6 - 8)
  })

  it('caps against the roomier side when it flips', () => {
    const read = place(600, 700)
    expect(read().dropUp).toBe(true)
    expect(read().maxHeight).toBe(560 - 6 - 8)
  })

  /** A cap of forty pixels is not a panel: better to overflow a little than
   *  to render a sliver nobody can use. */
  it('never caps below a usable height', () => {
    // A short window with the trigger near the middle — no real room anywhere.
    Object.defineProperty(window, 'innerHeight', { value: 300, configurable: true })
    const read = place(150, 700)
    expect(read().maxHeight).toBe(160)
  })

  /**
   * The calendar's hour and minute dropdowns sit on the bottom edge of the
   * calendar panel. Measured against the window there is often plenty of room
   * below them — a panel floating in the middle of a tall screen — and the
   * menu opened downward and hung out of the panel it belongs to.
   */
  describe('inside a container that declares its edge', () => {
    function placeWithin(
      triggerBottom: number,
      panelHeight: number,
      edge: { top: number; bottom: number },
    ) {
      let latest: { dropUp: boolean; maxHeight: number | undefined } = {
        dropUp: false,
        maxHeight: undefined,
      }

      function Inner() {
        const wrapRef = useRef<HTMLDivElement>(null)
        const panelRef = useRef<HTMLDivElement>(null)
        latest = useFlipPlacement(wrapRef, panelRef, true, { gap: 6, margin: 8 })
        return (
          <div>
            <div
              ref={(node) => {
                if (!node) return
                node.getBoundingClientRect = () =>
                  ({ top: triggerBottom - 40, bottom: triggerBottom }) as DOMRect
                ;(wrapRef as { current: HTMLDivElement | null }).current = node
              }}
            />
            <div
              ref={(node) => {
                if (!node) return
                Object.defineProperty(node, 'scrollHeight', {
                  value: panelHeight,
                  configurable: true,
                })
                ;(panelRef as { current: HTMLDivElement | null }).current = node
              }}
            />
          </div>
        )
      }

      function Harness() {
        const boundaryRef = useRef<HTMLDivElement>(null)
        return (
          <div
            ref={(node) => {
              if (!node) return
              node.getBoundingClientRect = () => edge as DOMRect
              ;(boundaryRef as { current: HTMLDivElement | null }).current = node
            }}
          >
            <PopoverBoundary value={boundaryRef}>
              <Inner />
            </PopoverBoundary>
          </div>
        )
      }

      render(<Harness />)
      return () => latest
    }

    it('flips at the container edge, not at the viewport', () => {
      // Trigger on the bottom edge of a panel that floats mid-screen. 380px of
      // window below it, but none of the panel.
      const read = placeWithin(420, 264, { top: 100, bottom: 420 })
      expect(read().dropUp).toBe(true)
    })

    it('still opens downward with room inside the container', () => {
      // The month and year selects, at the top of the same panel.
      const read = placeWithin(150, 264, { top: 100, bottom: 500 })
      expect(read().dropUp).toBe(false)
    })

    /** A container partly off-screen must not offer room that is not on the page. */
    it('never widens the room beyond the viewport', () => {
      const read = placeWithin(700, 264, { top: 100, bottom: 2000 })
      expect(read().dropUp).toBe(true)
    })
  })

  it('re-places when the page scrolls under an open panel', () => {
    let bottom = 200
    let latest: { dropUp: boolean } = { dropUp: false }

    function Harness() {
      const wrapRef = useRef<HTMLDivElement>(null)
      const panelRef = useRef<HTMLDivElement>(null)
      latest = useFlipPlacement(wrapRef, panelRef, true)
      return (
        <div>
          <div
            ref={(node) => {
              if (!node) return
              node.getBoundingClientRect = () => ({ top: bottom - 40, bottom }) as DOMRect
              ;(wrapRef as { current: HTMLDivElement | null }).current = node
            }}
          />
          <div
            ref={(node) => {
              if (!node) return
              Object.defineProperty(node, 'scrollHeight', { value: 400, configurable: true })
              ;(panelRef as { current: HTMLDivElement | null }).current = node
            }}
          />
        </div>
      )
    }

    render(<Harness />)
    expect(latest.dropUp).toBe(false)

    // The trigger rides down the screen as the page scrolls.
    bottom = 700
    act(() => {
      window.dispatchEvent(new Event('scroll'))
    })
    expect(latest.dropUp).toBe(true)
  })
})
