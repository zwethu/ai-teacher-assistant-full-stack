import { describe, expect, it } from 'vitest'

import {
  addDays,
  addMonths,
  formatDisplay,
  fromInputValue,
  monthGrid,
  sameDay,
  toDateTimeValue,
  toDateValue,
} from './dateValue'

describe('dateValue', () => {
  /**
   * The whole reason this module exists. `toISOString()` converts to UTC, so
   * east of Greenwich a late-evening deadline round-trips as the wrong day —
   * which is how `Games.tsx` came to carry its own local formatter.
   */
  it('formats from local parts, not UTC', () => {
    const late = new Date(2026, 7, 4, 23, 30)
    expect(toDateValue(late)).toBe('2026-08-04')
    expect(toDateTimeValue(late)).toBe('2026-08-04T23:30')
  })

  it('pads single digits', () => {
    expect(toDateTimeValue(new Date(2026, 0, 5, 9, 7))).toBe('2026-01-05T09:07')
  })

  it('parses back to the same local wall clock', () => {
    const parsed = fromInputValue('2026-08-04T23:30')
    expect(parsed?.getFullYear()).toBe(2026)
    expect(parsed?.getMonth()).toBe(7)
    expect(parsed?.getDate()).toBe(4)
    expect(parsed?.getHours()).toBe(23)
    expect(parsed?.getMinutes()).toBe(30)
  })

  it('reads a bare date as local midnight', () => {
    // `new Date('2026-08-04')` is UTC midnight, which is 4 August only west of
    // Greenwich — this must be the 4th everywhere.
    expect(fromInputValue('2026-08-04')?.getDate()).toBe(4)
    expect(fromInputValue('2026-08-04')?.getHours()).toBe(0)
  })

  it('rejects what it cannot parse', () => {
    expect(fromInputValue('')).toBeNull()
    expect(fromInputValue(null)).toBeNull()
    expect(fromInputValue('next tuesday')).toBeNull()
    // The constructor would roll this into March rather than refusing it.
    expect(fromInputValue('2026-02-31')).toBeNull()
  })

  it('steps a month without skipping one', () => {
    // The bug this guards: `setMonth` on the 31st lands in March, so paging
    // forward from 31 January would jump straight past February.
    const jan31 = new Date(2026, 0, 31)
    const next = addMonths(jan31, 1)
    expect(next.getMonth()).toBe(1)
    expect(next.getDate()).toBe(28)
  })

  it('keeps the time when stepping a month', () => {
    const stepped = addMonths(new Date(2026, 0, 15, 14, 45), 2)
    expect(stepped.getHours()).toBe(14)
    expect(stepped.getMinutes()).toBe(45)
  })

  it('crosses a year boundary', () => {
    expect(addMonths(new Date(2026, 11, 10), 1).getFullYear()).toBe(2027)
    expect(addDays(new Date(2026, 11, 31), 1).getFullYear()).toBe(2027)
  })

  describe('monthGrid', () => {
    /** A grid that changes height makes the popover jump between months. */
    it('is always six weeks', () => {
      for (let month = 0; month < 12; month += 1) {
        expect(monthGrid(new Date(2026, month, 1))).toHaveLength(42)
      }
    })

    it('starts on the Monday on or before the 1st', () => {
      // 1 August 2026 is a Saturday, so the grid opens on Monday 27 July.
      const grid = monthGrid(new Date(2026, 7, 1))
      expect(grid[0].getDay()).toBe(1)
      expect(grid[0].getMonth()).toBe(6)
      expect(grid[0].getDate()).toBe(27)
    })

    it('contains every day of the month exactly once', () => {
      const grid = monthGrid(new Date(2026, 1, 1))
      const inMonth = grid.filter((d) => d.getMonth() === 1)
      expect(inMonth).toHaveLength(28)
    })

    it('runs in unbroken daily steps', () => {
      const grid = monthGrid(new Date(2026, 2, 1))
      for (let i = 1; i < grid.length; i += 1) {
        expect(sameDay(grid[i], addDays(grid[i - 1], 1))).toBe(true)
      }
    })

    /** A month starting on a Monday must not lose its first week to the lead-in. */
    it('handles a month that already starts on Monday', () => {
      // 1 June 2026 is a Monday.
      const grid = monthGrid(new Date(2026, 5, 1))
      expect(sameDay(grid[0], new Date(2026, 5, 1))).toBe(true)
    })
  })

  it('formats a display string with and without the time', () => {
    const date = new Date(2026, 7, 4, 14, 30)
    expect(formatDisplay(date, false)).not.toMatch(/\d{2}:\d{2}/)
    expect(formatDisplay(date, true)).toMatch(/\d{1,2}:\d{2}/)
  })
})
