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
// Stands in for a large tree, but keeps the two controls the page owns — it
// hands them down, and where they end up inside the card is the view's business.
vi.mock('../components/generation/GenerationRunView', () => ({
  GenerationRunView: ({
    onDiscard,
    onGenerateAnother,
  }: {
    onDiscard?: () => void
    onGenerateAnother?: () => void
  }) => (
    <div>
      <span>run in progress</span>
      {onDiscard && (
        <button type="button" onClick={onDiscard}>
          Discard
        </button>
      )}
      {onGenerateAnother && (
        <button type="button" onClick={onGenerateAnother}>
          Generate another
        </button>
      )}
    </div>
  ),
}))

const idle = () => ({
  messages: [] as unknown[],
  // The real hook always supplies this;  indexes it.
  runStates: {} as Record<string, unknown>,
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
   * Every unfinished state, not only the two that wait on the lecturer.
   *
   * The workflow is persisted to localStorage, so any state without an exit is
   * a page that comes back on every reload — and the exit used to live inside
   * the run view at two specific stages.
   */
  it.each([
    ['mid-generation', { currentRunId: 'r1', sending: true, messages: [] as unknown[] }],
    [
      // `pending` is what `deriveGenerationStage` reads as work in flight; an
      // assistant message with bare metadata settles instead, and a settled run
      // offers "Generate another" rather than a discard.
      'a run that has produced a placeholder',
      {
        currentRunId: 'r1',
        messages: [
          { message_id: 'm1', role: 'assistant', content: '', run_id: 'r1', pending: true, metadata: {} },
        ],
      },
    ],
  ])('offers a way out while %s', async (_label, over) => {
    const user = userEvent.setup()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    runState = { ...idle(), ...over }
    renderPage()

    await user.click(screen.getByRole('button', { name: /Discard/ }))

    // Cancel first: `reset` alone would leave the backend generating into a
    // run nobody is listening to.
    expect(cancelRun).toHaveBeenCalled()
    expect(reset).toHaveBeenCalled()
    confirm.mockRestore()
  })

  it('asks before throwing the draft away', async () => {
    const user = userEvent.setup()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    runState = { ...idle(), currentRunId: 'r1', sending: true }
    renderPage()

    await user.click(screen.getByRole('button', { name: /Discard/ }))
    expect(reset).not.toHaveBeenCalled()
    confirm.mockRestore()
  })

  /**
   * The hang.
   *
   * `currentRunId` alone decided whether the run view took the page over, and
   * it is persisted — so an id that outlived its messages hid the form behind
   * a run view whose own stage was `idle`. The screen showed a stepper on step
   * one, the words "Fill in the form and click Generate to start", and no form
   * anywhere on it.
   */
  it('shows the form again when a persisted run has nothing left in it', async () => {
    runState = { ...idle(), currentRunId: 'stale-run', sending: false, messages: [] }
    renderPage()

    expect(await screen.findByRole('button', { name: /Generate outline/ })).toBeTruthy()
    expect(screen.queryByText('run in progress')).toBeNull()
  })
})
