// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import LessonPlans from './LessonPlans'

const listArtifacts = vi.fn()
const reset = vi.fn()
const cancelRun = vi.fn()
let runState: Record<string, unknown>

vi.mock('../services/artifactService', () => ({
  listArtifacts: (...args: unknown[]) => listArtifacts(...args),
}))

vi.mock('../hooks/useBatchSelection', () => ({
  useBatchSelection: () => ({
    batches: [{ id: 'b1', batch_name: 'ST 26', course_name: 'Software Testing' }],
    loading: false,
    selectedBatch: { id: 'b1', batch_name: 'ST 26', course_name: 'Software Testing' },
    selectedBatchId: 'b1',
    setSelectedBatchId: vi.fn(),
  }),
}))

vi.mock('../hooks/useWorkflowPrefill', () => ({ useWorkflowPrefill: () => null }))
vi.mock('../hooks/useGenerationRun', () => ({ useGenerationRun: () => runState }))
vi.mock('../components/generation/PlanHintBanner', () => ({ PlanHintBanner: () => null }))
vi.mock('../components/generation/GenerationAttachments', () => ({
  GenerationAttachments: () => null,
}))
// The run view is a large tree of its own; this stands in for it and exposes
// the one control under test.
vi.mock('../components/generation/GenerationRunView', () => ({
  GenerationRunView: ({ onDiscard }: { onDiscard?: () => void }) => (
    <div>
      <span>run in progress</span>
      {onDiscard && (
        <button type="button" onClick={onDiscard}>
          discard
        </button>
      )}
    </div>
  ),
}))

const idle = () => ({
  messages: [] as unknown[],
  currentRunId: null as string | null,
  sending: false,
  pendingAttachments: [],
  attachmentsUploading: false,
  attachmentErrors: [],
  generate: vi.fn(),
  removePendingAttachment: vi.fn(),
  uploadAttachmentFiles: vi.fn(),
  reset,
  cancelRun,
})

afterEach(cleanup)
beforeEach(() => {
  listArtifacts.mockReset().mockResolvedValue([
    {
      id: 'a1',
      type: 'lesson_plan',
      title: 'Week 3 — Test Doubles',
      week: 3,
      version: 1,
      updated_at: '2026-08-01T09:00:00Z',
      doc_url: 'https://docs.example/a1',
    },
  ])
  reset.mockReset()
  cancelRun.mockReset()
  runState = idle()
})

const renderPage = () =>
  render(
    <MemoryRouter>
      <LessonPlans />
    </MemoryRouter>,
  )

describe('a standalone generation page', () => {
  /**
   * The saved list used to be the `else` branch of "has a run started", so the
   * moment a lecturer pressed Generate their existing work vanished and only
   * came back when the run finished — the one time they might want to glance
   * at last week's plan is while this week's is being written.
   */
  it('keeps the saved list on screen while a generation runs', async () => {
    runState = { ...idle(), currentRunId: 'r1', sending: true }
    renderPage()

    expect(await screen.findByText('Week 3 — Test Doubles')).toBeTruthy()
    expect(screen.getByText('run in progress')).toBeTruthy()
    // The form is what gives way to the run, not the list.
    expect(screen.queryByRole('button', { name: /Generate outline/ })).toBeNull()
  })

  it('still shows it before anything has been generated', async () => {
    renderPage()
    expect(await screen.findByText('Week 3 — Test Doubles')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Generate outline/ })).toBeTruthy()
  })

  /**
   * Three across, not full-width rows. The row layout was a misreading of
   * "like the games page" — that was about the list *staying visible* through
   * a run, not about its shape.
   */
  it('lays the saved work out as cards', async () => {
    const { container } = renderPage()
    await screen.findByText('Week 3 — Test Doubles')

    expect(container.querySelector('article')).toBeTruthy()
    const grid = container.querySelector('article')!.parentElement!
    expect(grid.className).toContain('lg:grid-cols-3')
    // The tag went with the redesign and stays gone: everything here is
    // confirmed, so it was one word repeated on every card.
    expect(screen.queryByText(/confirmed/i)).toBeNull()
  })

  /**
   * The section used to sit inside a `space-y-6`; moving it out of the
   * form/run split took that with it and left the heading against the form
   * card's bottom edge.
   */
  it('keeps the heading clear of the form card', async () => {
    const { container } = renderPage()
    await screen.findByText('Week 3 — Test Doubles')

    const section = container.querySelector('form')!.closest('div')!.nextElementSibling
    expect((section as HTMLElement).className).toMatch(/\bmt-6\b/)
  })

  /**
   * With the list live rather than hidden behind the run, it has to pick up
   * what the run just produced — otherwise a lecturer watches a generation
   * finish above a list that still does not contain it.
   */
  it('reloads the list when the workflow settles', async () => {
    runState = { ...idle(), currentRunId: 'r1', sending: true }
    const { rerender } = renderPage()
    await waitFor(() => expect(listArtifacts).toHaveBeenCalled())
    const before = listArtifacts.mock.calls.length

    runState = {
      ...idle(),
      messages: [{ message_id: 'm1', role: 'assistant', content: 'done', metadata: {} }],
    }
    rerender(
      <MemoryRouter>
        <LessonPlans />
      </MemoryRouter>,
    )

    await waitFor(() => expect(listArtifacts.mock.calls.length).toBeGreaterThan(before))
  })

  /**
   * The waiting stages are persisted to localStorage so a reload can rejoin
   * them. Without a way out, the approval screen came back on every reload for
   * as long as the record existed.
   */
  it('offers a way out of a run that is waiting on the lecturer', async () => {
    const user = userEvent.setup()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    runState = {
      ...idle(),
      currentRunId: 'r1',
      messages: [{ message_id: 'm1', role: 'assistant', content: 'outline', metadata: {} }],
    }
    renderPage()

    await user.click(screen.getByRole('button', { name: 'discard' }))

    // Cancel first: `reset` alone would leave the backend generating into a
    // run nobody is listening to.
    expect(cancelRun).toHaveBeenCalled()
    expect(reset).toHaveBeenCalled()
    confirm.mockRestore()
  })

  /** Nothing in flight — there is no run to cancel, only local state to drop. */
  it('does not cancel a run that is not running', async () => {
    const user = userEvent.setup()
    runState = {
      ...idle(),
      messages: [{ message_id: 'm1', role: 'assistant', content: 'preview', metadata: {} }],
    }
    renderPage()

    await user.click(screen.getByRole('button', { name: 'discard' }))
    expect(cancelRun).not.toHaveBeenCalled()
    expect(reset).toHaveBeenCalled()
  })
})
