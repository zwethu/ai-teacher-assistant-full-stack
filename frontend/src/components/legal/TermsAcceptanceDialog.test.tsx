// @vitest-environment jsdom

import { readFileSync } from 'node:fs'

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { TermsAcceptanceDialog } from './TermsAcceptanceDialog'

const css = readFileSync('src/index.css', 'utf8')

afterEach(() => cleanup())

/* jsdom reports every scroll metric as 0, so the mount-time "nothing to
   scroll" check arms the checkbox immediately in every test here. That is the
   tall-viewport path, deliberately — do not "fix" it by stubbing metrics. */
function renderDialog(overrides: Partial<Parameters<typeof TermsAcceptanceDialog>[0]> = {}) {
  const onAccept = vi.fn()
  const onDecline = vi.fn()
  render(
    <TermsAcceptanceDialog
      open
      accepting={false}
      writeError={null}
      onAccept={onAccept}
      onDecline={onDecline}
      {...overrides}
    />,
  )
  return { onAccept, onDecline }
}

const dialog = () => screen.getByRole('alertdialog')

describe('TermsAcceptanceDialog', () => {
  /**
   * The two dismissal routes every other dialog offers are deliberately
   * absent: the gate exists to hold the app shut until the terms are
   * answered, and the only ways out are the two buttons.
   */
  it('ignores Escape', async () => {
    const user = userEvent.setup()
    const { onAccept, onDecline } = renderDialog()
    await user.keyboard('{Escape}')
    expect(dialog()).toBeTruthy()
    expect(onAccept).not.toHaveBeenCalled()
    expect(onDecline).not.toHaveBeenCalled()
  })

  it('ignores clicks on the backdrop', () => {
    const { onAccept, onDecline } = renderDialog()
    const backdrop = dialog().parentElement as HTMLElement
    fireEvent.pointerDown(backdrop)
    fireEvent.click(backdrop)
    expect(dialog()).toBeTruthy()
    expect(onAccept).not.toHaveBeenCalled()
    expect(onDecline).not.toHaveBeenCalled()
  })

  it('holds Accept shut until the box is ticked, and looks shut', async () => {
    const user = userEvent.setup()
    const { onAccept } = renderDialog()
    const accept = screen.getByRole('button', { name: 'Accept and continue' }) as HTMLButtonElement

    expect(accept.disabled).toBe(true)
    /* Looking shut matters as much as being shut: the design system fades a
       disabled button to opacity .55, which reads as armed. The `!` overrides
       are load-bearing — unlayered design-system CSS beats @layer utilities. */
    for (const cls of ['disabled:!bg-slate-200', 'disabled:!text-slate-500', 'disabled:!opacity-100']) {
      expect(accept.className).toContain(cls)
    }

    await user.click(screen.getByRole('checkbox'))
    expect(accept.disabled).toBe(false)
    await user.click(accept)
    expect(onAccept).toHaveBeenCalledTimes(1)
  })

  it('keeps the gate open and shows the error when the write fails', () => {
    renderDialog({ writeError: 'Couldn’t save your acceptance.' })
    expect(dialog()).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toContain('save your acceptance')
  })

  it('declines through its own button only', async () => {
    const user = userEvent.setup()
    const { onDecline } = renderDialog()
    await user.click(screen.getByRole('button', { name: 'Decline' }))
    expect(onDecline).toHaveBeenCalledTimes(1)
  })

  it('is an alertdialog with a resolvable label', () => {
    renderDialog()
    const box = dialog()
    expect(box.getAttribute('aria-modal')).toBe('true')
    const title = document.getElementById(box.getAttribute('aria-labelledby') ?? '')
    expect(title?.textContent).toBe('Terms and Privacy Notice')
  })

  /* The trap's *effect* is unobservable in jsdom — no layout, no inert
     semantics — so, as ConfirmDialog.test does, assert the pieces that
     enforce it: the entrance/exit CSS exists and the panel focuses the
     document region first so PageDown reads rather than acts. */
  it('animates and focuses the document first', () => {
    renderDialog()
    expect(css).toMatch(/@starting-style\s*\{[^@]*\.mila-dialog\s*\{[^}]*opacity:\s*0/)
    expect(css).toMatch(/\.mila-dialog\[data-leaving='true'\]/)
    const scrollRegion = dialog().querySelector('[tabindex="-1"]')
    expect(document.activeElement).toBe(scrollRegion)
  })
})
