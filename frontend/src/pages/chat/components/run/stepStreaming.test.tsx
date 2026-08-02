// @vitest-environment jsdom

import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AgentRunEvent } from '../../../../services/agentRunStream'
import type { RunUiState } from '../../runTypes'
import { RunDetails } from './RunDetails'

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

describe('a finished step', () => {
  /**
   * The defect this model replaced.
   *
   * A finished row used to be dropped 900ms after it settled, and the agent
   * usually thinks for longer than that before its next tool call — so the
   * panel reached zero rows between every step, collapsed, and reopened. That
   * is a full row of height moving twice per step, taking the thinking line
   * and the conversation with it.
   */
  it('stays in its lane rather than leaving on a timer', () => {
    const { container, rerender } = render(
      <RunDetails run={run(call('a', 'Checking saved materials', false))} isFinal={false} />,
    )
    expect(screen.getByText('Checking saved materials')).toBeTruthy()

    rerender(<RunDetails run={run(call('a', 'Checking saved materials', true))} isFinal={false} />)
    act(() => void vi.advanceTimersByTime(5_000))

    expect(screen.getByText('Checking saved materials')).toBeTruthy()
    expect(screen.getByText('Done')).toBeTruthy()
    expect(leavingRows(container).length).toBe(0)
  })

  /** One lane in, one lane out: the container's height never moves. */
  it('hands its lane to the next step instead of making room for it', () => {
    const finished = call('a', 'Checking saved materials', true)
    const { container, rerender } = render(
      <RunDetails run={run(call('a', 'Checking saved materials', false))} isFinal={false} />,
    )
    rerender(<RunDetails run={run(finished)} isFinal={false} />)
    expect(container.querySelectorAll('.mila-step-row').length).toBe(1)

    // The next step arrives. Under the old list model this was an insertion —
    // two rows — followed by a removal once the first one's window expired.
    rerender(
      <RunDetails
        run={run([...finished, ...call('b', 'Reading the course plan', false)])}
        isFinal={false}
      />,
    )

    expect(container.querySelectorAll('.mila-step-row').length).toBe(1)
    expect(screen.getByText('Reading the course plan')).toBeTruthy()
    expect(leavingRows(container).length).toBe(0)
  })

  it('crossfades the step it replaced rather than cutting to it', () => {
    const finished = call('a', 'Checking saved materials', true)
    const { container, rerender } = render(
      <RunDetails run={run(call('a', 'Checking saved materials', false))} isFinal={false} />,
    )
    rerender(<RunDetails run={run(finished)} isFinal={false} />)
    rerender(
      <RunDetails
        run={run([...finished, ...call('b', 'Reading the course plan', false)])}
        isFinal={false}
      />,
    )

    // Both are on screen for the length of the crossfade, stacked in one grid
    // cell so the outgoing one costs no layout.
    expect(container.querySelector('.mila-lane__out')).toBeTruthy()
    expect(screen.getByText('Checking saved materials')).toBeTruthy()

    act(() => void vi.advanceTimersByTime(400))

    expect(container.querySelector('.mila-lane__out')).toBeNull()
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
