import { describe, expect, it } from 'vitest'

import { groupByAge } from './groupChatsByAge'

/**
 * "Today" means the lecturer's today, so the boundary is local midnight — which
 * makes these fixtures timezone-sensitive if they are written as UTC strings.
 * Building them in local time keeps the suite honest wherever it runs; an
 * earlier draft passed in UTC and put last night's chat under Today in +07:00.
 */
const local = (y: number, m: number, d: number, h = 12) =>
  ({ when: new Date(y, m - 1, d, h).toISOString() })

// A Wednesday, mid-afternoon.
const NOW = new Date(2026, 7, 5, 15).getTime()
const labels = (groups: { label: string }[]) => groups.map((g) => g.label)

describe('grouping conversations by age', () => {
  it('counts today from midnight, not from 24 hours ago', () => {
    // 09:00 this morning is Today; 23:00 last night is not, even though it is
    // well inside the last 24 hours.
    const groups = groupByAge([local(2026, 8, 5, 9), local(2026, 8, 4, 23)], (i) => i.when, NOW)

    expect(labels(groups)).toEqual(['Today', 'This week'])
  })

  it('treats this week as the last seven days, not the calendar week', () => {
    // The Sunday three days back. A calendar week starting Monday would file
    // this under Older on a Wednesday, which is not what "this week" means to
    // someone looking for what they did at the weekend.
    const groups = groupByAge([local(2026, 8, 2)], (i) => i.when, NOW)

    expect(labels(groups)).toEqual(['This week'])
  })

  it('drops empty bands rather than printing an empty heading', () => {
    const groups = groupByAge([local(2026, 1, 1)], (i) => i.when, NOW)

    expect(labels(groups)).toEqual(['Older'])
  })

  it('keeps the incoming order inside a band', () => {
    const rows = [local(2026, 8, 5, 14), local(2026, 8, 5, 10), local(2026, 8, 5, 12)]
    const groups = groupByAge(rows, (i) => i.when, NOW)

    // Newest-first is the caller's job; grouping must not quietly re-sort.
    expect(groups[0].items).toEqual(rows)
  })

  it('files undated rows with the oldest instead of inventing a date', () => {
    const groups = groupByAge([{ when: null }, local(2026, 8, 5, 10)], (i) => i.when, NOW)

    expect(labels(groups)).toEqual(['Today', 'Older'])
  })
})
