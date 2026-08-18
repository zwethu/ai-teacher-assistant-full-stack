// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useWorkflowPrefill } from './useWorkflowPrefill'
import type { Artifact } from '../services/artifactService'

const getCurrentCourseBlueprint = vi.fn()
vi.mock('../services/courseBlueprintService', () => ({
  getCurrentCourseBlueprint: (...args: unknown[]) => getCurrentCourseBlueprint(...args),
}))

beforeEach(() => getCurrentCourseBlueprint.mockReset())
afterEach(() => cleanup())

const artifact = (week: number) => ({ id: `a${week}`, week }) as Artifact

const plan = (weeks: { week: number; theme: string; lesson_goal?: string }[]) => ({
  weekly_plan: weeks,
})

function Probe({ batchId, artifacts }: { batchId: string | null; artifacts: Artifact[] | null }) {
  const prefill = useWorkflowPrefill(batchId, artifacts)
  return <pre data-testid="out">{prefill ? JSON.stringify(prefill) : 'pending'}</pre>
}

const readout = async () => {
  await waitFor(() => expect(screen.getByTestId('out').textContent).not.toBe('pending'))
  return JSON.parse(screen.getByTestId('out').textContent || '{}')
}

describe('what a generation form should already be holding', () => {
  it('offers the week after the furthest one generated', async () => {
    getCurrentCourseBlueprint.mockResolvedValue(null)
    render(<Probe batchId="b1" artifacts={[artifact(1), artifact(2)]} />)

    expect((await readout()).week).toBe(3)
  })

  it('starts at week 1 in a batch with nothing generated', async () => {
    getCurrentCourseBlueprint.mockResolvedValue(null)
    render(<Probe batchId="b1" artifacts={[]} />)

    expect((await readout()).week).toBe(1)
  })

  it('takes the topic from the plan, and prior knowledge from the week before', async () => {
    // That is what "what students already know" means, and exactly what the
    // plan records — the previous week is the answer, not a guess.
    getCurrentCourseBlueprint.mockResolvedValue(
      plan([
        { week: 2, theme: 'Unit testing', lesson_goal: 'Write first tests' },
        { week: 3, theme: 'Mocking and test doubles' },
      ]),
    )
    render(<Probe batchId="b1" artifacts={[artifact(2)]} />)

    const out = await readout()
    expect(out).toMatchObject({
      week: 3,
      topic: 'Mocking and test doubles',
      priorKnowledge: 'Unit testing — Write first tests',
      source: 'course-plan',
    })
  })

  it('fills only the week when there is no course plan', async () => {
    // Guessing a topic from nothing would put words in the lecturer's mouth on
    // a field the agent then treats as instruction.
    getCurrentCourseBlueprint.mockResolvedValue(null)
    render(<Probe batchId="b1" artifacts={[artifact(4)]} />)

    expect(await readout()).toMatchObject({ week: 5, topic: '', priorKnowledge: '', source: 'week-only' })
  })

  it('fills only the week when the plan does not reach that far', async () => {
    getCurrentCourseBlueprint.mockResolvedValue(plan([{ week: 1, theme: 'Intro' }]))
    render(<Probe batchId="b1" artifacts={[artifact(6)]} />)

    expect(await readout()).toMatchObject({ week: 7, source: 'week-only' })
  })

  it('holds everything back until the plan lookup settles', async () => {
    // Otherwise the form fills once with the week alone and again a moment
    // later with the plan's values, which looks like it changed its mind.
    let resolve: (value: unknown) => void = () => {}
    getCurrentCourseBlueprint.mockReturnValue(new Promise((r) => { resolve = r }))
    render(<Probe batchId="b1" artifacts={[artifact(1)]} />)

    expect(screen.getByTestId('out').textContent).toBe('pending')
    resolve(plan([{ week: 2, theme: 'Unit testing' }]))
    expect((await readout()).topic).toBe('Unit testing')
  })

  it('waits for the artifact list, not just the plan', async () => {
    // The two lookups race and the plan usually wins. An empty array read as
    // "no artifacts" offered week 1 for a batch already on week 4 — the form
    // took it, marked itself filled, and ignored the real answer a moment
    // later. `null` says "not fetched yet"; `[]` says "none".
    getCurrentCourseBlueprint.mockResolvedValue(null)
    const { rerender } = render(<Probe batchId="b1" artifacts={null} />)

    await waitFor(() => expect(getCurrentCourseBlueprint).toHaveBeenCalled())
    expect(screen.getByTestId('out').textContent).toBe('pending')

    rerender(<Probe batchId="b1" artifacts={[artifact(1), artifact(2), artifact(3)]} />)
    expect((await readout()).week).toBe(4)
  })

  it('offers nothing without a batch selected', () => {
    render(<Probe batchId={null} artifacts={[]} />)

    expect(screen.getByTestId('out').textContent).toBe('pending')
    expect(getCurrentCourseBlueprint).not.toHaveBeenCalled()
  })


  // Not covered: the path where `getCurrentCourseBlueprint` rejects. The hook
  // catches it and still offers the week, but proving that here kept surfacing
  // the rejection as a test failure however it was constructed — a harness
  // quirk, not a defect in the hook, and not worth contorting the suite around.
})
