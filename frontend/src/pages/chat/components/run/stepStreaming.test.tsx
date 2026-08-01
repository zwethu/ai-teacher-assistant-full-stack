// @vitest-environment jsdom

import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AgentRunEvent } from '../../../../services/agentRunStream'
import type { RunUiState } from '../../runTypes'
import { RunDetails } from './RunDetails'
import { STEP_SETTLE_MS } from './useSettlingRows'

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  vi.useRealTimers()
  cleanup()
})

let seq = 0
function event(overrides: Partial<AgentRunEvent>): AgentRunEvent {
  seq += 1
  return {
    event_id: `e${seq}`,
    kind: 'tool',
    status: 'running',
    title: '',
    created_at: seq,
    ...overrides,
  } as AgentRunEvent
}

const call = (id: string, title: string, finished: boolean) =>
  finished
    ? [event({ tool_call_id: id, title, status: 'started' }), event({ tool_call_id: id, title, status: 'success' })]
    : [event({ tool_call_id: id, title, status: 'started' })]

const run = (events: AgentRunEvent[]): RunUiState => ({ status: 'running', events, steps: {} })

/** A row on its way out is flagged for the length of its collapse. */
const leavingRows = (container: HTMLElement) =>
  container.querySelectorAll('.mila-step-row[data-leaving="true"]')

describe('a step leaving the live view', () => {
  it('animates out even when it is the last one', () => {
    // The whole panel used to unmount the instant the row count hit zero,
    // taking the presence list — and therefore the exit animation — with it.
    // That happens between every pair of sequential steps, not just at the end.
    const { container, rerender } = render(
      <RunDetails run={run(call('a', 'Checking saved materials', false))} isFinal={false} />,
    )
    expect(screen.getByText('Checking saved materials')).toBeTruthy()

    // It finishes, is held for its "Done" beat, then drops out of the list.
    rerender(<RunDetails run={run(call('a', 'Checking saved materials', true))} isFinal={false} />)
    act(() => void vi.advanceTimersByTime(STEP_SETTLE_MS + 20))

    expect(leavingRows(container).length).toBe(1)
  })

  it('is gone once its exit has played', () => {
    const { container, rerender } = render(
      <RunDetails run={run(call('a', 'Checking saved materials', false))} isFinal={false} />,
    )
    rerender(<RunDetails run={run(call('a', 'Checking saved materials', true))} isFinal={false} />)
    act(() => void vi.advanceTimersByTime(STEP_SETTLE_MS + 20))
    expect(leavingRows(container).length).toBe(1)

    act(() => void vi.advanceTimersByTime(400))

    expect(leavingRows(container).length).toBe(0)
    expect(screen.queryByText('Checking saved materials')).toBeNull()
  })

  it('leaves nothing behind that could push the message around', () => {
    // The wrapper carries `mt-2`; with no rows and no banner it must collapse
    // entirely rather than hold 8px open for the gap between steps.
    const { container } = render(<RunDetails run={run([])} isFinal={false} />)

    expect(container.querySelector('.mt-2')?.childElementCount ?? 0).toBe(0)
    expect(container.querySelector('.empty\\:hidden')).toBeTruthy()
  })
})

describe('the run finishing', () => {
  it('collapses its rows instead of swapping them away', () => {
    // Switching straight to the "Worked for … · N steps" summary destroyed the
    // presence list mid-flight, so every visible row vanished on the frame the
    // run settled — the same defect as returning null between steps, at the
    // other boundary. On a long answer, where the turn has already outgrown its
    // floor, that shrink is a visible jump the moment the answer completes.
    const events = call('a', 'Checking saved materials', false)
    const { container, rerender } = render(<RunDetails run={run(events)} isFinal={false} />)

    rerender(<RunDetails run={{ status: 'done', events, steps: {} }} isFinal />)

    expect(leavingRows(container).length).toBe(1)
  })

  it('shows the summary once they have gone', () => {
    const events = call('a', 'Checking saved materials', true)
    const { container, rerender } = render(<RunDetails run={run(events)} isFinal={false} />)
    rerender(<RunDetails run={{ status: 'done', events, steps: {} }} isFinal />)

    act(() => void vi.advanceTimersByTime(400))

    expect(leavingRows(container).length).toBe(0)
    expect(container.textContent).toContain('step')
  })
})

describe('a fan-out settling', () => {
  it('holds each row in the position it occupied', () => {
    const three = [...call('a', 'Reading the course plan', false),
                   ...call('b', 'Checking saved materials', false),
                   ...call('c', 'Reading a saved quiz', false)]
    const { container, rerender } = render(<RunDetails run={run(three)} isFinal={false} />)

    // The middle one finishes first. `normalizeRunRows` sorts by `updated_at`,
    // so without arrival ordering it would hop below the other two before
    // collapsing, dragging the rows above it up through the gap.
    const settledMiddle = [...call('a', 'Reading the course plan', false),
                           ...call('b', 'Checking saved materials', true),
                           ...call('c', 'Reading a saved quiz', false)]
    rerender(<RunDetails run={run(settledMiddle)} isFinal={false} />)

    const titles = [...container.querySelectorAll('.mila-step-row')]
      .map((node) => node.textContent || '')
    expect(titles[0]).toContain('Reading the course plan')
    expect(titles[1]).toContain('Checking saved materials')
    expect(titles[2]).toContain('Reading a saved quiz')
  })
})
