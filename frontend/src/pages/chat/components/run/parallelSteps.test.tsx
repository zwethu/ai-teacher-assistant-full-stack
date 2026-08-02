// @vitest-environment jsdom

import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AgentRunEvent } from '../../../../services/agentRunStream'
import type { RunUiState } from '../../runTypes'
import { isRowActive, normalizeRunRows, type NormalizedRunRow } from './normalizeRunRows'
import { RunDetails } from './RunDetails'
import { StepsPanel } from './StepsPanel'
import { formatDuration, runDurationSeconds, runSummaryLabel } from './runDuration'
import { ThinkingPanel } from './ThinkingPanel'

afterEach(() => cleanup())

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

/** One tool call as the agent emits it: a start, then optionally an end,
 *  both carrying the same tool_call_id. */
function toolCall(id: string, title: string, finished: boolean): AgentRunEvent[] {
  const started = event({ tool_call_id: id, title, status: 'started' })
  if (!finished) return [started]
  return [started, event({ tool_call_id: id, title, status: 'success' })]
}

function run(events: AgentRunEvent[], status: RunUiState['status']): RunUiState {
  return { status, events, steps: {} }
}

describe('parallel tool calls', () => {
  it('keeps one row per call, so a fan-out is several active rows at once', () => {
    const rows = normalizeRunRows(
      {},
      [
        ...toolCall('a', 'Checking the course plan', true),
        ...toolCall('b', 'Checking saved materials', false),
        ...toolCall('c', 'Reading a saved quiz', false),
      ],
      'running',
    )

    expect(rows).toHaveLength(3)
    // The finished one has settled; the two still in flight are both active —
    // the case that did not exist when tools ran strictly one at a time.
    expect(rows.filter(isRowActive).map((row) => row.title)).toEqual([
      'Checking saved materials',
      'Reading a saved quiz',
    ])
  })

  it('shows only what is in flight while the run is live, and offers no toggle', () => {
    render(
      <RunDetails
        run={run(
          [
            ...toolCall('a', 'Checking the course plan', true),
            ...toolCall('b', 'Checking saved materials', false),
          ],
          'running',
        )}
        isFinal={false}
      />,
    )

    expect(screen.queryByText('Checking the course plan')).toBeNull()
    expect(screen.getByText('Checking saved materials')).toBeTruthy()
    // Nothing to collapse: what is on screen is already only the live rows.
    expect(screen.queryByRole('button', { name: /steps/i })).toBeNull()
  })

  it('hands back every stored step once the run finishes', () => {
    render(
      <RunDetails
        run={run(
          [
            ...toolCall('a', 'Checking the course plan', true),
            ...toolCall('b', 'Checking saved materials', true),
          ],
          'done',
        )}
        isFinal
      />,
    )

    // Collapsed by default, but the steps that vanished during the run are
    // all present — removing them from the live view never dropped them.
    // Events run 1s..4s, so the run summary reports a 3s span.
    const toggle = screen.getByRole('button', { name: /Worked for 3s · 2 steps/ })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.getByText('Checking the course plan')).toBeTruthy()
    expect(screen.getByText('Checking saved materials')).toBeTruthy()
  })

  it('lets a step show its Done badge, and keeps showing it', async () => {
    vi.useFakeTimers()
    try {
      const { rerender } = render(
        <RunDetails run={run(toolCall('a', 'Checking saved materials', false), 'running')} isFinal={false} />,
      )
      expect(screen.getByText('Running')).toBeTruthy()

      // The completion arrives. Dropping the row on this frame is what made a
      // step's finish invisible — it has to be seen finishing.
      rerender(
        <RunDetails run={run(toolCall('a', 'Checking saved materials', true), 'running')} isFinal={false} />,
      )
      expect(screen.getByText('Done')).toBeTruthy()
      expect(screen.getByText('Checking saved materials')).toBeTruthy()

      // And it stays. The lane holds the last thing the agent did in that slot
      // until something replaces it, so there is no window during which the
      // panel has nothing to show and collapses.
      await act(async () => {
        vi.advanceTimersByTime(5_000)
      })
      expect(screen.getByText('Checking saved materials')).toBeTruthy()
      expect(screen.getByText('Done')).toBeTruthy()
    } finally {
      vi.useRealTimers()
    }
  })

  /**
   * Concurrency dropping is real information and should be animated; a timer
   * expiring is not. The old model closed rows 900ms after each settled, which
   * took a fan-out of three through 3 → 1 → 2 → 1 — the count went back *up*
   * because one row's completion landed between two expiries.
   */
  it('closes the lanes a narrower wave does not need, in one move', () => {
    const running = [
      ...toolCall('a', 'Reading the course plan', false),
      ...toolCall('b', 'Checking saved materials', false),
      ...toolCall('c', 'Reading a saved quiz', false),
    ]
    const fanOut = [
      ...toolCall('a', 'Reading the course plan', true),
      ...toolCall('b', 'Checking saved materials', true),
      ...toolCall('c', 'Reading a saved quiz', true),
    ]
    const { container, rerender } = render(<RunDetails run={run(running, 'running')} isFinal={false} />)
    expect(container.querySelectorAll('.mila-step-row').length).toBe(3)

    // All three finish. The lanes stay — nothing has asked for them yet.
    rerender(<RunDetails run={run(fanOut, 'running')} isFinal={false} />)
    expect(container.querySelectorAll('.mila-step-row[data-leaving="true"]').length).toBe(0)

    // One step follows the fan-out. It takes over the oldest lane; the other
    // two close together, on this frame, rather than on their own timers.
    rerender(
      <RunDetails
        run={run([...fanOut, ...toolCall('d', 'Writing the outline', false)], 'running')}
        isFinal={false}
      />,
    )

    expect(container.querySelectorAll('.mila-step-row[data-leaving="true"]').length).toBe(2)
    expect(screen.getByText('Writing the outline')).toBeTruthy()
  })

  it('does not warn that updates are delayed while steps are streaming', () => {
    const streaming = {
      ...run(toolCall('a', 'Checking saved materials', false), 'running'),
      streamError: 'Live updates are delayed. I will fetch the final response when ready.',
    }
    const { rerender } = render(<RunDetails run={streaming} isFinal={false} />)

    // Rows on screen are the evidence the run is alive; the fallback polling
    // the warning describes happens either way.
    expect(screen.queryByText(/Live updates are delayed/)).toBeNull()
    expect(screen.getByText('Checking saved materials')).toBeTruthy()

    // With nothing streaming, the silence needs explaining.
    rerender(<RunDetails run={{ ...streaming, events: [] }} isFinal={false} />)
    expect(screen.getByText(/Live updates are delayed/)).toBeTruthy()
  })

  it('staggers a fan-out but not a step that arrives on its own', () => {
    const row = (id: string): NormalizedRunRow => ({
      id,
      kind: 'tool',
      title: `Step ${id}`,
      status: 'running',
    })
    const delays = (container: HTMLElement) =>
      [...container.querySelectorAll('.mila-step-row:not([data-leaving])')].map((node) =>
        (node as HTMLElement).style.getPropertyValue('--mila-step-delay'),
      )

    const lane = (id: string) => ({ id: `lane-${id}`, row: row(id) })

    const { container, rerender } = render(
      <StepsPanel live lanes={[lane('a'), lane('b'), lane('c')]} />,
    )
    expect(delays(container)).toEqual(['0ms', '45ms', '90ms'])

    // A fourth step, arriving by itself later. Staggering by list position
    // would hand it 135ms of delay it did not earn — the cascade belongs to
    // rows that appear together, which is what a parallel fan-out looks like.
    rerender(<StepsPanel live lanes={[lane('a'), lane('b'), lane('c'), lane('d')]} />)
    expect(delays(container)).toEqual(['0ms', '45ms', '90ms', '0ms'])
  })

  /**
   * A commit that both opens and closes lanes moves as one piece.
   *
   * The stagger is a delay on the opening height only, so on a mixed commit it
   * un-pairs the two curves that are meant to cancel: evaluated, a staggered
   * arrival against an unstaggered departure put the container at 0.174 of a
   * row rather than a flat 1.000.
   */
  it('drops the stagger on a wave that also closes lanes', () => {
    const lane = (id: string) => ({
      id: `lane-${id}`,
      row: { id, kind: 'tool', title: `Step ${id}`, status: 'running' } as NormalizedRunRow,
    })
    const delays = (container: HTMLElement) =>
      [...container.querySelectorAll('.mila-step-row:not([data-leaving])')].map((node) =>
        (node as HTMLElement).style.getPropertyValue('--mila-step-delay'),
      )

    const { container, rerender } = render(
      <StepsPanel live lanes={[lane('a'), lane('b')]} />,
    )
    // `a` and `b` go, `c` and `d` arrive, all on one frame.
    rerender(<StepsPanel live lanes={[lane('c'), lane('d')]} />)

    expect(container.querySelectorAll('.mila-step-row[data-leaving="true"]').length).toBe(2)
    expect(delays(container)).toEqual(['0ms', '0ms'])
  })

  it('holds a step in place when it finishes instead of letting it hop', () => {
    // normalizeRunRows sorts by updated_at, so a completion event pushes that
    // row past the ones still running. In a fan-out that meant the finishing
    // step jumped to the bottom, showed "Done" somewhere new, and collapsed
    // from there while the rest slid up to fill the gap it had left.
    const titles = () => screen.getAllByText(/^Step /).map((node) => node.textContent)

    const running = [
      ...toolCall('a', 'Step a', false),
      ...toolCall('b', 'Step b', false),
      ...toolCall('c', 'Step c', false),
    ]
    const { rerender } = render(<RunDetails run={run(running, 'running')} isFinal={false} />)
    expect(titles()).toEqual(['Step a', 'Step b', 'Step c'])

    // 'a' finishes last of all, so its updated_at is now the newest.
    rerender(
      <RunDetails
        run={run([...running, event({ tool_call_id: 'a', title: 'Step a', status: 'success' })], 'running')}
        isFinal={false}
      />,
    )
    expect(titles()).toEqual(['Step a', 'Step b', 'Step c'])
  })

  it('clears a row whose completion event never arrived when the run ends', () => {
    // Two parallel calls to one tool with identical args collide in the
    // agent's in-flight map, so one never gets its "done". It must not be
    // left sitting in the finished list as forever-running.
    const rows = normalizeRunRows({}, toolCall('a', 'Consulting the course plan', false), 'done')
    expect(rows.filter(isRowActive)).toHaveLength(0)
  })
})

describe('ThinkingPanel', () => {
  const thinking = [
    event({ kind: 'thinking', status: 'running', summary: 'Consulting the course plan...' }),
  ]

  it('never offers a way to expand it', () => {
    render(<ThinkingPanel events={thinking} runStatus="running" />)
    expect(screen.getByText('Consulting the course plan...')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('renders nothing for a finished run it never saw running', () => {
    const { container } = render(<ThinkingPanel events={thinking} runStatus="done" />)
    expect(container.textContent).toBe('')
  })

  it('leaves when the run finishes rather than summarising it', async () => {
    // The run summary owns the duration now; a "Thought for 36s" line directly
    // above "Worked for 1m 12s" was two clocks on one piece of work.
    vi.useFakeTimers()
    try {
      const { rerender, container } = render(
        <ThinkingPanel events={thinking} runStatus="running" />,
      )
      rerender(<ThinkingPanel events={thinking} runStatus="done" />)

      // Still on screen for its exit, still saying what it last said.
      expect(container.querySelector('.mila-step-row[data-leaving="true"]')).toBeTruthy()
      expect(container.textContent).toContain('Consulting the course plan...')

      await act(async () => {
        vi.advanceTimersByTime(400)
      })
      expect(container.textContent).toBe('')
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('run duration', () => {
  it('reads epoch seconds and milliseconds off the same run', () => {
    // The agent stamps events in seconds; the backend stamps step nodes in
    // milliseconds. Both land on one run, and mixing the units unconverted
    // yields a duration in the tens of millions of seconds.
    const seconds = runDurationSeconds(
      [event({ created_at: 1_700_000_000 }), event({ created_at: 1_700_000_072 })],
      { s1: { step_id: 's1', title: 'Working', status: 'done', updated_at: 1_700_000_030_000 } },
    )
    expect(seconds).toBe(72)
    expect(formatDuration(seconds)).toBe('1m 12s')
  })

  it('says nothing about duration when there is nothing to measure', () => {
    expect(formatDuration(runDurationSeconds([event({ created_at: 5 })], {}))).toBe('')
    expect(runSummaryLabel('done', 2, '')).toBe('Completed 2 steps')
    expect(runSummaryLabel('failed', 1, '12s')).toBe('Failed after 12s · 1 step')
  })
})
