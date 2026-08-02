/**
 * Wall-clock date strings, the way `<input type="date">` means them.
 *
 * All of this is deliberately local-time. `toISOString()` converts to UTC
 * first, so in Bangkok (UTC+7) a deadline of "23:00 on the 4th" round-trips as
 * "16:00 on the 4th" and a midnight date lands on the previous day. `Games.tsx`
 * already carried its own `toLocalInputValue` for exactly this reason; this is
 * that function and its inverse, in one place, so the next surface does not
 * have to rediscover the bug.
 */

const pad = (n: number) => String(n).padStart(2, '0')

/** `YYYY-MM-DD`, from local parts. */
export function toDateValue(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** `YYYY-MM-DDTHH:mm`, from local parts. */
export function toDateTimeValue(date: Date): string {
  return `${toDateValue(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function toInputValue(date: Date, withTime: boolean): string {
  return withTime ? toDateTimeValue(date) : toDateValue(date)
}

/**
 * Parse a `YYYY-MM-DD[THH:mm]` string into a local `Date`, or null.
 *
 * Built from parts rather than handed to `new Date(string)`, which treats a
 * bare `YYYY-MM-DD` as UTC midnight — the same off-by-one-day the writers
 * above avoid.
 */
export function fromInputValue(value: string | null | undefined): Date | null {
  if (!value) return null
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(value.trim())
  if (!match) return null
  const [, y, m, d, hh, mm] = match
  const date = new Date(Number(y), Number(m) - 1, Number(d), Number(hh ?? 0), Number(mm ?? 0), 0, 0)
  // Rejects the 31st of February, which the constructor would roll into March.
  if (date.getMonth() !== Number(m) - 1 || date.getDate() !== Number(d)) return null
  return date
}

/** Midnight local on the same day — the unit the calendar grid compares in. */
export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

/**
 * Add months without the 31st-of-January problem: `setMonth(1)` on the 31st
 * gives the 2nd or 3rd of March, so a lecturer paging forward from the 31st
 * would skip February entirely.
 */
export function addMonths(date: Date, months: number): Date {
  const target = new Date(date.getFullYear(), date.getMonth() + months, 1)
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate()
  target.setDate(Math.min(date.getDate(), lastDay))
  target.setHours(date.getHours(), date.getMinutes(), 0, 0)
  return target
}

export function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  )
}

/**
 * The six-week grid for a month, Monday-first.
 *
 * Always 42 cells, including the tail of the previous month and the head of
 * the next. A grid that changes height between months makes the popover jump
 * as you page through it, which is the one thing a calendar must not do.
 */
export function monthGrid(month: Date): Date[] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1)
  // getDay() is Sunday-0; shift so Monday is 0.
  const lead = (first.getDay() + 6) % 7
  const start = addDays(first, -lead)
  return Array.from({ length: 42 }, (_, i) => addDays(start, i))
}

/** How the chosen value reads once the field is closed. */
export function formatDisplay(date: Date, withTime: boolean): string {
  const day = date.toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
  if (!withTime) return day
  const time = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  return `${day}, ${time}`
}
