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
import { STEP_SETTLE_MS } from './useSettlingRows'

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

  it('lets a step show its Done badge before it leaves', async () => {
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

      // Then, and only then, it goes — grace window plus its exit animation.
      await act(async () => {
        vi.advanceTimersByTime(STEP_SETTLE_MS + 400)
      })
      expect(screen.queryByText('Checking saved materials')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
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
      [...container.querySelectorAll('.mila-step-in')].map((node) =>
        (node as HTMLElement).style.getPropertyValue('--mila-step-delay'),
      )

    const { container, rerender } = render(
      <StepsPanel live rows={[row('a'), row('b'), row('c')]} />,
    )
    expect(delays(container)).toEqual(['0ms', '45ms', '90ms'])

    // A fourth step, arriving by itself later. Staggering by list position
    // would hand it 135ms of delay it did not earn — the cascade belongs to
    // rows that appear together, which is what a parallel fan-out looks like.
    rerender(<StepsPanel live rows={[row('a'), row('b'), row('c'), row('d')]} />)
    expect(delays(container)).toEqual(['0ms', '45ms', '90ms', '0ms'])
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
      expect(container.querySelector('.mila-step-out')).toBeTruthy()
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
