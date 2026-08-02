// @vitest-environment jsdom

import { readFileSync } from 'node:fs'

import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import Toast from './Toast'

const css = readFileSync('src/index.css', 'utf8')

afterEach(cleanup)

describe('the toast', () => {
  /**
   * A 4px coloured `border-left` is the default treatment for a status strip,
   * and on a glass surface it was the one detail that made this read as a
   * library component dropped into the app. Nothing else in MILA marks type
   * with a bar down one edge.
   */
  it('marks its type with a disc, not a bar down one edge', () => {
    const { container } = render(
      <Toast toast={{ type: 'success', message: 'Deleted.' }} onDismiss={vi.fn()} />,
    )
    const surface = container.querySelector('.mila-toast') as HTMLElement
    expect(surface.className).not.toMatch(/border-l-\d/)
    expect(container.querySelector('.rounded-full.bg-emerald-100')).toBeTruthy()
  })

  /**
   * Success is the one thing a lecturer can safely miss; a failure has to
   * interrupt, or it is announced to nobody.
   */
  it('interrupts for a failure and does not for a success', () => {
    const { unmount } = render(
      <Toast toast={{ type: 'error', message: 'Could not delete.' }} onDismiss={vi.fn()} />,
    )
    expect(screen.getByRole('alert')).toBeTruthy()
    unmount()

    render(<Toast toast={{ type: 'success', message: 'Deleted.' }} onDismiss={vi.fn()} />)
    expect(screen.getByRole('status')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  /**
   * It used to be unmounted the instant its state went null, so after five
   * seconds of sitting there it blinked out. The message has to survive its
   * own dismissal or there is nothing left to fade.
   */
  it('keeps its message on screen while it leaves', () => {
    vi.useFakeTimers()
    try {
      const { rerender } = render(
        <Toast toast={{ type: 'success', message: 'Deleted.' }} onDismiss={vi.fn()} />,
      )
      rerender(<Toast toast={null} onDismiss={vi.fn()} />)

      // Still drawn, still readable, and flagged for its exit.
      const leaving = document.querySelector('.mila-toast[data-leaving="true"]')
      expect(leaving).toBeTruthy()
      expect(leaving!.textContent).toContain('Deleted.')

      act(() => {
        vi.advanceTimersByTime(400)
      })
      expect(document.querySelector('.mila-toast')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('dismisses on the close button', async () => {
    const user = userEvent.setup()
    const onDismiss = vi.fn()
    render(<Toast toast={{ type: 'success', message: 'Deleted.' }} onDismiss={onDismiss} />)

    await user.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(onDismiss).toHaveBeenCalled()
  })

  /**
   * It is pinned to the bottom-right, and the vendored version entered from
   * `translateY(-8px)` — sliding *down* into a corner it could not have come
   * from. Both directions are positive now: up on the way in, back down on the
   * way out.
   */
  it('rises out of the corner it lives in', () => {
    const enter = /@starting-style\s*\{\s*\.mila-toast\s*\{([^}]*)\}/.exec(css)
    expect(enter).toBeTruthy()
    expect(enter![1]).toMatch(/translate3d\(0,\s*12px/)

    const leave = /\.mila-toast\[data-leaving='true'\]\s*\{([^}]*)\}/.exec(css)
    expect(leave![1]).toMatch(/translate3d\(0,\s*8px/)
  })

  /** Faster out than in: it has been read by then. */
  it('leaves quicker than it arrives', () => {
    const enter = Number(/\.mila-toast\s*\{[^}]*?(\d+)ms/s.exec(css)?.[1])
    const leave = Number(
      /\.mila-toast\[data-leaving='true'\]\s*\{[^}]*transition-duration:\s*(\d+)ms/.exec(css)?.[1],
    )
    expect(leave).toBeLessThan(enter)
  })
})
