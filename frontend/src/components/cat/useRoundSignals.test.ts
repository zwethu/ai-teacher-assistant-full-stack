// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'

import { useRoundSignals } from './useRoundSignals'

// A controllable monotonic clock. The hook reads performance.now() and nothing
// else, which is the point — a test that had to move the wall clock could not
// tell a correct implementation from one that trusts Date.now().
let now = 0
const advance = (ms: number) => { now += ms }

beforeEach(() => {
  now = 0
  vi.spyOn(performance, 'now').mockImplementation(() => now)
})
afterEach(() => vi.restoreAllMocks())

function round() {
  const { result } = renderHook(() => useRoundSignals())
  // Mirror the modes: the board re-anchors the round once it is on screen.
  result.current.resetRound()
  return result.current
}

describe('round signals', () => {
  it('times each submit separately, not just the round', () => {
    // The defect this guards: only the round total was ever recorded, so one
    // considered answer and six frantic guesses produced the same number.
    const r = round()

    advance(3_000)
    r.recordFirstAction()          // player finally touches the board
    advance(9_000)
    r.recordSubmit(2)              // 12s in, first attempt, 2 wrong
    advance(4_000)
    r.recordFirstAction()          // reading the feedback ends here
    advance(1_000)
    r.recordSubmit(0)              // 17s in, cleared

    const s = r.buildSignals()

    expect(s.submissions).toEqual([
      { index: 1, atMsSinceRoundStart: 12_000, durationMs: 12_000, clean: false, wrongCount: 2 },
      { index: 2, atMsSinceRoundStart: 17_000, durationMs: 5_000,  clean: true,  wrongCount: 0 },
    ])
    expect(s.submitCount).toBe(2)
    expect(s.wrongSubmitCount).toBe(1)
    expect(s.totalWrongLinksOrPairs).toBe(2)
    expect(s.solveDurationMs).toBe(17_000)
    expect(s.firstActionDelayMs).toBe(3_000)
    expect(s.reviewTimesMs).toEqual([4_000])   // feedback shown → next action
  })

  it('reports no planning delay when the player never acted', () => {
    // 0 would read as "answered instantly" — the opposite of what happened.
    const r = round()
    advance(30_000)

    expect(r.buildSignals().firstActionDelayMs).toBeNull()
  })

  it('leaves solve time unset when the round never cleared', () => {
    const r = round()
    advance(5_000)
    r.recordSubmit(3)

    const s = r.buildSignals()
    expect(s.solveDurationMs).toBeNull()
    expect(s.submitCount).toBe(1)
  })

  it('freezes a reported round against later submits', () => {
    // The engine keeps the snapshot; a stray submit landing during the
    // celebration must not rewrite a round it has already filed.
    const r = round()
    r.recordSubmit(0)
    const filed = r.buildSignals()

    advance(1_000)
    r.recordSubmit(1)

    expect(filed.submissions).toHaveLength(1)
    expect(r.buildSignals().submissions).toHaveLength(2)
  })

  it('starts the next round from scratch', () => {
    const r = round()
    r.recordFirstAction()
    r.recordSubmit(1)

    advance(2_000)
    r.resetRound()
    advance(1_500)
    r.recordSubmit(0)

    const s = r.buildSignals()
    expect(s.submitCount).toBe(1)
    expect(s.wrongSubmitCount).toBe(0)
    expect(s.totalWrongLinksOrPairs).toBe(0)
    expect(s.solveDurationMs).toBe(1_500)
    expect(s.submissions[0].durationMs).toBe(1_500)
  })
})
