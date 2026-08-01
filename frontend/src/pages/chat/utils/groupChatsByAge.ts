export type AgeGroup<T> = { label: string; items: T[] }

/**
 * Split a newest-first list into Today / This week / Older.
 *
 * Three bands, not seven: the list is already in order, so the headings say
 * roughly how far back you have scrolled, not what date each row is. A band per
 * day would put a heading between almost every pair of rows.
 *
 * "This week" is the last seven days, not the calendar week — on a Monday
 * morning a calendar week files yesterday's work under "Older".
 *
 * Generic over the row because the two surfaces that list conversations hold
 * different shapes (`Chat` keyed on `created_at`, the sessions list on
 * `updated_at`) and should not disagree about where the boundaries fall.
 */
const DAY_MS = 24 * 60 * 60 * 1000

export function groupByAge<T>(
  items: T[],
  timestampOf: (item: T) => string | null | undefined,
  now: number = Date.now(),
): AgeGroup<T>[] {
  const startOfToday = new Date(now)
  startOfToday.setHours(0, 0, 0, 0)
  const todayFrom = startOfToday.getTime()
  const weekFrom = now - 7 * DAY_MS

  const today: T[] = []
  const week: T[] = []
  const older: T[] = []

  for (const item of items) {
    const raw = timestampOf(item)
    // Undated rows file with the oldest rather than inventing a date. In
    // practice that is a chat created a second ago whose server timestamp has
    // not come back yet — and it is at the top of the list either way.
    const at = raw ? new Date(raw).getTime() : Number.NaN
    if (Number.isNaN(at)) older.push(item)
    else if (at >= todayFrom) today.push(item)
    else if (at >= weekFrom) week.push(item)
    else older.push(item)
  }

  return [
    { label: 'Today', items: today },
    { label: 'This week', items: week },
    { label: 'Older', items: older },
  ].filter((group) => group.items.length > 0)
}
