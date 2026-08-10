// @vitest-environment jsdom
//
// The round-clear lockout. A cleared board stays fully paired, so `allPaired`
// — the only thing that used to gate Submit — is still true all through the
// 1.8s celebration. That left the button live and every press re-graded the
// same board: extra submits on the record, and one queued page turn per press.
//
// Match & Treat is the click-driven mode, so it's the one a test can actually
// drive; Rope & Link and Bucket Fill carry the identical guard.

import { cleanup, render, screen, act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import MatchAndTreat from './MatchAndTreat'
import type { GameItem } from '../../../types/catGame.types'

// Audio and Lottie have no business running in jsdom.
vi.mock('../juice', () => ({
  playSnap: vi.fn(),
  playUnsnap: vi.fn(),
}))
vi.mock('../CardBird', () => ({ default: () => null }))

const ITEMS: GameItem[] = [
  { id: 'q1', term: 'Photosynthesis', definition: 'Light into sugar' },
  { id: 'q2', term: 'Respiration',    definition: 'Sugar into energy' },
]

beforeEach(() => vi.useFakeTimers())
afterEach(() => { vi.useRealTimers(); cleanup() })

const click = (text: string) => act(() => { screen.getByText(text).click() })
const submitBtn = () =>
  screen.getByRole('button', { name: /submit answers/i }) as HTMLButtonElement

/** Pairs every item correctly, leaving the board one press from cleared. */
function pairEverythingCorrectly() {
  for (const item of ITEMS) {
    click(item.term)
    click(item.definition)
  }
}

function renderMode() {
  const onComplete = vi.fn()
  render(
    <MatchAndTreat
      items={ITEMS}
      timeUp={false}
      onCorrect={vi.fn()}
      onWrong={vi.fn()}
      onComplete={onComplete}
    />,
  )
  return onComplete
}

describe('MatchAndTreat submit lockout', () => {
  it('reports the round once no matter how often Submit is pressed', () => {
    const onComplete = renderMode()

    pairEverythingCorrectly()
    act(() => { submitBtn().click() })

    // Mid-celebration: the spam window.
    act(() => { vi.advanceTimersByTime(400) })
    for (let i = 0; i < 5; i++) act(() => { submitBtn().click() })

    act(() => { vi.advanceTimersByTime(3000) })

    expect(onComplete).toHaveBeenCalledTimes(1)
  })

  it('does not count the extra presses as submits', () => {
    const onComplete = renderMode()

    pairEverythingCorrectly()
    act(() => { submitBtn().click() })
    for (let i = 0; i < 5; i++) act(() => { submitBtn().click() })
    act(() => { vi.advanceTimersByTime(3000) })

    // One press, cleanly cleared. Spam used to land here as submitCount 6 with
    // five extra zero-wrong submissions — which reads as a confident player
    // hammering a solved board, and is exactly backwards.
    const [, signals] = onComplete.mock.calls[0]
    expect(signals.submitCount).toBe(1)
    expect(signals.submissions).toHaveLength(1)
    expect(signals.wrongSubmitCount).toBe(0)
  })

  it('closes the button once the round is cleared', () => {
    renderMode()

    pairEverythingCorrectly()
    expect(submitBtn().disabled).toBe(false)

    act(() => { submitBtn().click() })
    expect(submitBtn().disabled).toBe(true)
  })

  it('still gates Submit until every card is paired', () => {
    renderMode()

    expect(submitBtn().disabled).toBe(true)
    click(ITEMS[0].term)
    click(ITEMS[0].definition)
    expect(submitBtn().disabled).toBe(true)   // one pair short

    click(ITEMS[1].term)
    click(ITEMS[1].definition)
    expect(submitBtn().disabled).toBe(false)
  })

  it('reopens Submit after a wrong round so the player can retry', () => {
    const onComplete = renderMode()

    // Cross-pair them: both wrong.
    click(ITEMS[0].term)
    click(ITEMS[1].definition)
    click(ITEMS[1].term)
    click(ITEMS[0].definition)
    act(() => { submitBtn().click() })

    act(() => { vi.advanceTimersByTime(3000) })
    expect(onComplete).not.toHaveBeenCalled()

    // Wrong pairs bounce back to unpaired, so Submit is gated on re-pairing —
    // not stuck closed by the clear lock.
    expect(submitBtn().disabled).toBe(true)
    pairEverythingCorrectly()
    expect(submitBtn().disabled).toBe(false)

    act(() => { submitBtn().click() })
    act(() => { vi.advanceTimersByTime(3000) })
    expect(onComplete).toHaveBeenCalledTimes(1)
  })
})
