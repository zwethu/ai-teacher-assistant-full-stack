// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import type { AgentRunEvent } from '../../../../services/agentRunStream'
import { ThinkingPanel } from './ThinkingPanel'

afterEach(() => cleanup())

/**
 * Sending a request runs through three states before the answer: no run yet,
 * a run with no working notes, then the notes streaming. The mark shown has to
 * stay the same size in the same place across all three, or the row jumps
 * twice on the way to an answer.
 *
 * The two marks are different animations on purpose — the Spinner's garland
 * strings itself for *loading*, the Thinking mark walks its gold bead for
 * *agent work*, and MILA never interchanges them. So they crossfade in a fixed
 * box rather than being swapped.
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
})
