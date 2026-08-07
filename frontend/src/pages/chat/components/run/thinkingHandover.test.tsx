// @vitest-environment jsdom

import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AgentRunEvent } from '../../../../services/agentRunStream'
import { ThinkingPanel } from './ThinkingPanel'

afterEach(() => cleanup())

/**
 * Sending a request runs through three states before the answer: no run yet,
 * a run with no working notes, then the notes streaming. The mark shown has to
 * stay the same size in the same place across all three, or the row jumps
 * twice on the way to an answer.
 *
 * The two marks are different animations — the Spinner's garland strings
 * itself, the Thinking mark walks its gold bead — and they crossfade in a fixed
 * box rather than being swapped. Once the agent is reporting thoughts they now
 * take turns at random intervals, which is a deliberate departure from the
 * design system's rule that the two are never interchanged.
 */
const note = (summary: string): AgentRunEvent =>
  ({ event_id: 'e1', kind: 'thinking', status: 'running', summary, created_at: 1 }) as AgentRunEvent

/** The fixed box both marks are stacked inside. */
const markSlot = (container: HTMLElement) => container.querySelector('.h-8.w-8')

describe('loading handing over to thinking', () => {
  it('holds one box the same size in both phases', () => {
    const { container: waiting } = render(<ThinkingPanel events={[]} runStatus="running" />)
    const before = markSlot(waiting)?.className

    cleanup()

    const { container: working } = render(
      <ThinkingPanel events={[note('Weighing two framings')]} runStatus="running" />,
    )

    expect(before).toBeTruthy()
    expect(markSlot(working)?.className).toBe(before)
  })

  it('keeps both marks mounted so the handover can crossfade', () => {
    // Swapping one for the other is a hard cut; the row is the one thing on
    // screen at that moment, so the cut is all you see.
    const { container } = render(
      <ThinkingPanel events={[note('Weighing two framings')]} runStatus="running" />,
    )

    const faded = [...container.querySelectorAll<HTMLElement>('[style*="opacity"]')]
    expect(faded).toHaveLength(2)
    expect(faded.map((node) => node.style.opacity).sort()).toEqual(['0', '1'])
  })

  it('inverts which mark is showing once notes arrive', () => {
    const { container: waiting } = render(<ThinkingPanel events={[]} runStatus="running" />)
    const before = [...waiting.querySelectorAll<HTMLElement>('[style*="opacity"]')].map(
      (node) => node.style.opacity,
    )

    cleanup()

    const { container: working } = render(
      <ThinkingPanel events={[note('Weighing two framings')]} runStatus="running" />,
    )
    const after = [...working.querySelectorAll<HTMLElement>('[style*="opacity"]')].map(
      (node) => node.style.opacity,
    )

    expect(before).toEqual(['1', '0'])
    expect(after).toEqual(['0', '1'])
  })

  it('shows no text until there is a note to show', () => {
    render(<ThinkingPanel events={[]} runStatus="running" />)

    expect(screen.queryByText(/Waiting for agent/)).toBeNull()
  })

  it('hides the mark that is faded out from assistive tech', () => {
    const { container } = render(<ThinkingPanel events={[]} runStatus="running" />)

    const hidden = container.querySelectorAll('[aria-hidden="true"][style*="opacity"]')
    expect(hidden).toHaveLength(1)
  })

  /**
   * The wait before the agent's first word is the longest silent moment in the
   * app, and it was the one place the brand mark showed up grey: `tone="muted"`
   * paints the thread and every bead slate, including the gold insight bead —
   * the one part of the mark that is not purple.
   */
  it('draws the loader in brand colour, not slate', () => {
    const { container } = render(<ThinkingPanel events={[]} runStatus="running" />)
    const thread = container.querySelector('svg circle')

    expect(thread?.getAttribute('stroke')).toContain('violet')
  })
})

/**
 * A single mark held for the length of a long run reads as one frozen loop.
 * Taking turns at random keeps the wait feeling attended to — and random
 * rather than fixed so it never settles into a metronome.
 */
describe('the two marks taking turns', () => {
  const showing = (container: HTMLElement) =>
    [...container.querySelectorAll<HTMLElement>('[style*="opacity"]')]
      .map((node) => node.style.opacity)
      .join('/')

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('swaps to the loader and back while the agent is working', () => {
    // Pinned to the low end of the 9–18s dwell, so the test is about the
    // swapping rather than about which number came out of Math.random.
    vi.spyOn(Math, 'random').mockReturnValue(0)
    vi.useFakeTimers()

    const { container } = render(
      <ThinkingPanel events={[note('Weighing two framings')]} runStatus="running" />,
    )
    expect(showing(container)).toBe('0/1')

    act(() => void vi.advanceTimersByTime(8800))
    expect(showing(container), 'swapped before its dwell was up').toBe('0/1')

    act(() => void vi.advanceTimersByTime(400))
    expect(showing(container), 'never handed over to the loader').toBe('1/0')

    act(() => void vi.advanceTimersByTime(9000))
    expect(showing(container), 'handed over once and stayed there').toBe('0/1')
  })

  /**
   * Before the first note the loader is not one of two moods, it is the truth:
   * nothing has started thinking yet. Alternating here would claim the agent
   * was at work during the prep window, which is the misreport the synthetic
   * "Reading your request…" note was already silenced for.
   */
  it('leaves the pre-agent wait alone, and still hands over on the first note', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    vi.useFakeTimers()

    const { container, rerender } = render(<ThinkingPanel events={[]} runStatus="running" />)
    expect(showing(container)).toBe('1/0')

    // Past one dwell, so a clock that should not be running has had time to
    // tick exactly once — an even number of swaps would land back where it
    // started and prove nothing.
    act(() => void vi.advanceTimersByTime(10_000))
    expect(showing(container)).toBe('1/0')

    // The load-bearing half: a clock left running through the prep window would
    // be mid-swap when the agent finally speaks, so the first note would arrive
    // under the loader and the handover this file exists for would not happen.
    rerender(<ThinkingPanel events={[note('Weighing two framings')]} runStatus="running" />)
    expect(showing(container), 'the first note did not take the thinking mark').toBe('0/1')
  })
})
