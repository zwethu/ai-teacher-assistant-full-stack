// @vitest-environment jsdom

import { useState } from 'react'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DateField, fullDayLabel } from './DateField'

afterEach(cleanup)

function Harness({
  initial = '2026-08-04',
  withTime = false,
  min,
  onChange,
}: {
  initial?: string
  withTime?: boolean
  min?: string
  onChange?: (v: string) => void
}) {
  const [value, setValue] = useState(initial)
  return (
    <DateField
      label="Deadline"
      withTime={withTime}
      min={min}
      value={value}
      onChange={(v) => {
        setValue(v)
        onChange?.(v)
      }}
    />
  )
}

const field = () => screen.getByLabelText('Deadline') as HTMLInputElement
const panel = () => screen.queryByRole('dialog')

/* Cells are named by their full date, not by a bare number — a screen reader
   on "5" cannot tell which of the two months in the grid it belongs to. The
   test builds the same label so it stays locale-independent. */
const day = (y: number, m: number, d: number) =>
  within(screen.getByRole('grid')).getByRole('gridcell', {
    name: fullDayLabel(new Date(y, m - 1, d)),
  }) as HTMLButtonElement

/** The day the arrow keys are on, read off the trigger. */
const cursorDay = () => {
  const id = field().getAttribute('aria-activedescendant')
  return document.getElementById(id ?? '')?.getAttribute('aria-label')
}

describe('DateField', () => {
  it('shows the date in a readable form, not as an ISO string', () => {
    render(<Harness />)
    // Locale-dependent, so this asserts the shape rather than the exact words.
    expect(field().value).toContain('2026')
    expect(field().value).not.toBe('2026-08-04')
    expect(panel()).toBeNull()
  })

  it('opens the calendar on click, on the selected month', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(field())

    expect(panel()).not.toBeNull()
    expect((screen.getByLabelText('Month') as HTMLInputElement).value).toBe('August')
    expect((screen.getByLabelText('Year') as HTMLInputElement).value).toBe('2026')
  })

  it('picks a day and closes', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    await user.click(field())
    await user.click(day(2026, 8, 12))

    expect(onChange).toHaveBeenCalledWith('2026-08-12')
    expect(panel()).toBeNull()
  })

  /**
   * Picking a new day must not silently reset the clock — a 23:59 deadline
   * moved to the following week is still 23:59.
   */
  it('carries the time across when the day changes', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Harness initial="2026-08-04T23:30" withTime onChange={onChange} />)
    await user.click(field())
    await user.click(day(2026, 8, 12))

    expect(onChange).toHaveBeenCalledWith('2026-08-12T23:30')
  })

  /** With a time still to set, closing on the day would be closing halfway. */
  it('stays open after a day is picked when there is a time to set', async () => {
    const user = userEvent.setup()
    render(<Harness initial="2026-08-04T09:00" withTime />)
    await user.click(field())
    await user.click(day(2026, 8, 12))

    expect(panel()).not.toBeNull()
  })

  /**
   * The time is picked, not typed into a native `<input type="time">`. These
   * assert the 24-hour arrangement, which is what the test environment's
   * locale resolves to; the component swaps in a 12-hour hour list and a
   * meridiem column where the locale says so.
   */
  it('picks an hour without moving the day', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Harness initial="2026-08-04T09:00" withTime onChange={onChange} />)
    await user.click(field())
    await user.click(screen.getByLabelText('Hour'))
    await user.click(screen.getByRole('option', { name: '14' }))

    expect(onChange).toHaveBeenLastCalledWith('2026-08-04T14:00')
  })

  it('picks a minute without moving the hour', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Harness initial="2026-08-04T09:00" withTime onChange={onChange} />)
    await user.click(field())
    await user.click(screen.getByLabelText('Minute'))
    await user.click(screen.getByRole('option', { name: '45' }))

    expect(onChange).toHaveBeenLastCalledWith('2026-08-04T09:45')
  })

  /** Sixty rows is a scroll; two keystrokes is not. */
  it('narrows the minute list by typing', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Harness initial="2026-08-04T09:00" withTime onChange={onChange} />)
    await user.click(field())
    await user.click(screen.getByLabelText('Minute'))
    await user.keyboard('59{Enter}')

    expect(onChange).toHaveBeenLastCalledWith('2026-08-04T09:59')
  })

  it('offers the times a deadline usually lands on', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Harness initial="2026-08-04T09:00" withTime onChange={onChange} />)
    await user.click(field())
    // Labelled through the locale's own clock format, so this finds it the
    // same way in a 12-hour locale.
    const label = new Date(2000, 0, 1, 23, 59).toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    })
    await user.click(screen.getByRole('button', { name: label }))

    expect(onChange).toHaveBeenLastCalledWith('2026-08-04T23:59')
  })

  /** Midnight and noon are where a 12/24-hour conversion goes wrong. */
  it('keeps midnight at 00:00, not at noon', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Harness initial="2026-08-04T13:30" withTime onChange={onChange} />)
    await user.click(field())
    await user.click(screen.getByLabelText('Hour'))
    await user.click(screen.getByRole('option', { name: '00' }))

    expect(onChange).toHaveBeenLastCalledWith('2026-08-04T00:30')
  })

  it('reaches another month by name rather than by paging', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(field())
    await user.click(screen.getByLabelText('Month'))
    await user.click(screen.getByRole('option', { name: 'March' }))

    expect((screen.getByLabelText('Month') as HTMLInputElement).value).toBe('March')
  })

  it('pages a month with the chevrons', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(field())
    await user.click(screen.getByLabelText('Next month'))
    expect((screen.getByLabelText('Month') as HTMLInputElement).value).toBe('September')

    await user.click(screen.getByLabelText('Previous month'))
    await user.click(screen.getByLabelText('Previous month'))
    expect((screen.getByLabelText('Month') as HTMLInputElement).value).toBe('July')
  })

  it('moves across the grid with the arrow keys and commits with Enter', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    await user.click(field())
    expect(cursorDay()).toBe(fullDayLabel(new Date(2026, 7, 4)))
    // One day right, one week down: the 4th → the 5th → the 12th.
    await user.keyboard('{ArrowRight}{ArrowDown}')
    expect(cursorDay()).toBe(fullDayLabel(new Date(2026, 7, 12)))

    await user.keyboard('{Enter}')
    expect(onChange).toHaveBeenCalledWith('2026-08-12')
  })

  it('jumps a month with PageDown and a year with Shift+PageDown', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(field())

    await user.keyboard('{PageDown}')
    expect((screen.getByLabelText('Month') as HTMLInputElement).value).toBe('September')

    await user.keyboard('{Shift>}{PageDown}{/Shift}')
    expect((screen.getByLabelText('Year') as HTMLInputElement).value).toBe('2027')
  })

  it('closes on Escape without picking anything', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    await user.click(field())
    await user.keyboard('{ArrowRight}{Escape}')

    expect(panel()).toBeNull()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('blocks days before the minimum', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Harness initial="2026-08-15" min="2026-08-10" onChange={onChange} />)
    await user.click(field())

    // No jest-dom in this project, so this reads the property directly.
    expect(day(2026, 8, 5).disabled).toBe(true)
    expect(day(2026, 8, 20).disabled).toBe(false)
    await user.click(day(2026, 8, 5))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('takes a typed date', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    await user.click(field())
    await user.keyboard('2026-12-25{Enter}')

    expect(onChange).toHaveBeenCalledWith('2026-12-25')
  })

  it('ignores a typed value it cannot parse, leaving the old one alone', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    await user.click(field())
    await user.keyboard('next tuesday{Enter}')

    expect(onChange).not.toHaveBeenCalled()
  })

  /**
   * "Tomorrow" names one day — the one after today — and must keep naming it
   * however many times it is pressed, and whatever is already in the field.
   * It used to resolve from the selection, so it stepped: pressing it on a
   * field holding next March meant the day after *that*, and pressing it twice
   * walked two days out.
   */
  it('resolves a preset against the clock, not the value in the field', async () => {
    /* Only Date — faking timers wholesale would stall userEvent's own. */
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(new Date(2026, 7, 4, 15, 30))
      const user = userEvent.setup()
      const onChange = vi.fn()
      // A selection months away from "now", so a step-relative preset can't
      // coincidentally land on the right answer.
      render(<Harness initial="2027-03-20" onChange={onChange} />)

      // A date-only field closes on commit, so each press needs its own open.
      const press = async (label: string) => {
        await user.click(field())
        await user.click(screen.getByRole('button', { name: label }))
      }

      await press('Tomorrow')
      expect(onChange).toHaveBeenLastCalledWith('2026-08-05')

      // And again — the second press means the same day, not the day after.
      await press('Tomorrow')
      expect(onChange).toHaveBeenLastCalledWith('2026-08-05')

      await press('Next week')
      expect(onChange).toHaveBeenLastCalledWith('2026-08-11')
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not open on focus alone', () => {
    render(<Harness />)
    field().focus()
    expect(panel()).toBeNull()
  })
})
