// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

import Games from './Games'
import { fromInputValue } from '../components/ui/dateValue'

const listGames = vi.fn()
const listArtifacts = vi.fn()
const generate = vi.fn()
const removePendingAttachment = vi.fn()
const useBatchSelection = vi.fn()
// The composer/form renders real preview tiles, so a fixture needs the fields a
// real attachment carries (kind, content type, name) — not just an id.
type AttachmentFixture = {
  attachment_id: string
  file_name: string
  content_type: string
  attachment_kind: string
  size_bytes: number
  status: string
}
let pendingAttachments: AttachmentFixture[] = []

vi.mock('../services/gameService', () => ({
  listGames: (...args: unknown[]) => listGames(...args),
  deleteGame: vi.fn(),
  updateGame: vi.fn(),
  gamePlayUrl: (gameId: string) => `${window.location.origin}/play/${gameId}`,
}))

vi.mock('../services/artifactService', () => ({
  listArtifacts: (...args: unknown[]) => listArtifacts(...args),
}))

vi.mock('../hooks/useBatchSelection', () => ({
  useBatchSelection: () => useBatchSelection(),
}))

vi.mock('../hooks/useGenerationRun', () => ({
  useGenerationRun: () => ({
    messages: [],
    currentRunId: null,
    sending: false,
    pendingAttachments,
    attachmentsUploading: false,
    attachmentErrors: [],
    generate: (...args: unknown[]) => generate(...args),
    removePendingAttachment: (...args: unknown[]) => removePendingAttachment(...args),
    uploadAttachmentFiles: vi.fn(),
    reset: vi.fn(),
  }),
}))

// The run view is only reached after a run starts; these tests cover the form before it.
vi.mock('../components/generation/GenerationRunView', () => ({
  GenerationRunView: () => null,
}))

const batch = { id: 'batch-1', batch_name: 'Batch 2026', course_name: 'Software Testing' }

afterEach(() => cleanup())
beforeEach(() => {
  listGames.mockReset().mockResolvedValue([])
  listArtifacts.mockReset().mockResolvedValue([])
  generate.mockReset()
  removePendingAttachment.mockReset()
  pendingAttachments = []
  // The chosen deadline is persisted per space so it survives leaving the page
  // mid-run. That means it also survives between tests unless cleared.
  sessionStorage.clear()
  useBatchSelection.mockReturnValue({
    batches: [batch],
    loading: false,
    selectedBatch: batch,
    selectedBatchId: 'batch-1',
    setSelectedBatchId: vi.fn(),
  })
})

const lessonPlan = {
  id: 'art-1',
  type: 'lesson_plan',
  title: 'Week 3 — Test Doubles',
  batch_id: 'batch-1',
  week: 3,
}

function renderPage() {
  return render(
    <MemoryRouter>
      <Games />
    </MemoryRouter>,
  )
}

/**
 * Saved work lives behind a dialog, so the form asks one question — what is this
 * built from — instead of making the lecturer pick a mechanism first.
 */
async function openSavedWork() {
  await userEvent.click(screen.getByRole('button', { name: /Use saved work/ }))
}

describe('Games — source picker', () => {
  it('refuses to generate until a source is chosen', async () => {
    renderPage()

    await waitFor(() => expect(listArtifacts).toHaveBeenCalledWith('batch-1', { current: true }))
    const button = screen.getByRole('button', { name: /Generate game/ })
    expect(button.hasAttribute('disabled')).toBe(true)
    expect(screen.getByText(/Upload a document or pick saved work to continue/)).toBeTruthy()
  })

  it('offers saved lesson plans, labs, and assessments as input', async () => {
    listArtifacts.mockResolvedValue([
      lessonPlan,
      { id: 'art-2', type: 'lab', title: 'Week 4 Lab', batch_id: 'batch-1', week: 4 },
      // Course plans are strategy, not term-bearing content — must not be offered.
      { id: 'art-3', type: 'course_blueprint', title: 'Course Plan', batch_id: 'batch-1' },
    ])
    renderPage()
    await openSavedWork()

    await waitFor(() => expect(screen.getByText('Week 3 — Test Doubles')).toBeTruthy())
    expect(screen.getByText('Week 4 Lab')).toBeTruthy()
    expect(screen.queryByText('Course Plan')).toBeNull()
  })

  it('sends the artifact type and week so the agent reads the right saved work', async () => {
    listArtifacts.mockResolvedValue([lessonPlan])
    renderPage()
    await openSavedWork()

    await waitFor(() => expect(screen.getByText('Week 3 — Test Doubles')).toBeTruthy())
    await userEvent.click(screen.getByRole('radio', { name: /Week 3 — Test Doubles/ }))
    await userEvent.click(screen.getByRole('button', { name: /Generate game/ }))

    await waitFor(() => expect(generate).toHaveBeenCalled())
    const params = generate.mock.calls[0][0]
    expect(params.workflowType).toBe('game')
    expect(params.message).toContain('lesson_plan')
    expect(params.message).toContain('week 3')
    // A game comes from one source only — never the open web.
    expect(params.webSearch).toBe(false)
  })

  it('asks for 30 pairs by default and sends the chosen count', async () => {
    listArtifacts.mockResolvedValue([lessonPlan])
    renderPage()
    await openSavedWork()

    await waitFor(() => expect(screen.getByText('Week 3 — Test Doubles')).toBeTruthy())
    const field = screen.getByLabelText('Number of pairs') as HTMLInputElement
    expect(field.value).toBe('30')
    // 30 seconds a pair — the standard 30-pair game is a 15-minute round.
    expect(screen.getByText('About 15 min to play')).toBeTruthy()

    await userEvent.clear(field)
    await userEvent.type(field, '12')
    await userEvent.click(screen.getByRole('radio', { name: /Week 3 — Test Doubles/ }))
    await userEvent.click(screen.getByRole('button', { name: /Generate game/ }))

    await waitFor(() => expect(generate).toHaveBeenCalled())
    expect(generate.mock.calls[0][0].message).toContain('exactly 12 term/definition pairs')
  })

  it('refuses a pair count the backend would reject', async () => {
    listArtifacts.mockResolvedValue([lessonPlan])
    renderPage()
    await openSavedWork()

    await waitFor(() => expect(screen.getByText('Week 3 — Test Doubles')).toBeTruthy())
    await userEvent.click(screen.getByRole('radio', { name: /Week 3 — Test Doubles/ }))
    const field = screen.getByLabelText('Number of pairs')
    await userEvent.clear(field)
    await userEvent.type(field, '99')

    expect(screen.getByText('Pick between 4 and 40')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Generate game/ }).hasAttribute('disabled')).toBe(true)
  })

  it('has no deadline until one is asked for', async () => {
    renderPage()

    await waitFor(() => expect(listArtifacts).toHaveBeenCalled())
    expect(screen.queryByLabelText('Deadline')).toBeNull()
    expect(screen.getByText(/stays open until you close it/)).toBeTruthy()
  })

  it('offers a week from now as the starting deadline', async () => {
    renderPage()

    await waitFor(() => expect(listArtifacts).toHaveBeenCalled())
    await userEvent.click(screen.getByLabelText('Set a deadline'))

    // Read from session storage rather than off the field: the field now shows
    // a localised display string ("Tue 11 Aug 2026, 09:00"), and parsing that
    // back would be leaning on whatever `new Date(string)` happens to accept.
    const stored = sessionStorage.getItem('mila:game-deadline:batch-1') ?? ''
    expect(stored).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
    const chosen = (fromInputValue(stored)?.getTime() ?? 0) - Date.now()
    expect(chosen).toBeGreaterThan(6.5 * 86_400_000)
    expect(chosen).toBeLessThan(7.5 * 86_400_000)
  })

  /**
   * The picker itself now refuses to *offer* a past date — every day before
   * `min` is disabled in the grid and a typed one is rejected — so this drives
   * the one route by which a stale deadline still reaches the form: the
   * generator restores an in-flight deadline from session storage, and one
   * left there overnight is in the past by morning.
   */
  it('refuses a deadline that has already passed', async () => {
    sessionStorage.setItem('mila:game-deadline:batch-1', '2020-01-01T09:00')
    listArtifacts.mockResolvedValue([lessonPlan])
    renderPage()
    await openSavedWork()

    await waitFor(() => expect(screen.getByText('Week 3 — Test Doubles')).toBeTruthy())
    await userEvent.click(screen.getByRole('radio', { name: /Week 3 — Test Doubles/ }))

    expect(screen.getByText('Pick a date and time in the future.')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Generate game/ }).hasAttribute('disabled')).toBe(true)
  })

  /** The other half of the same guard: a future deadline blocks nothing. */
  it('accepts a deadline that is still ahead', async () => {
    const future = new Date(Date.now() + 7 * 86_400_000)
    const pad = (n: number) => String(n).padStart(2, '0')
    sessionStorage.setItem(
      'mila:game-deadline:batch-1',
      `${future.getFullYear()}-${pad(future.getMonth() + 1)}-${pad(future.getDate())}T09:00`,
    )
    listArtifacts.mockResolvedValue([lessonPlan])
    renderPage()
    await openSavedWork()

    await waitFor(() => expect(screen.getByText('Week 3 — Test Doubles')).toBeTruthy())
    await userEvent.click(screen.getByRole('radio', { name: /Week 3 — Test Doubles/ }))

    expect(screen.queryByText('Pick a date and time in the future.')).toBeNull()
    expect(screen.getByRole('button', { name: /Generate game/ }).hasAttribute('disabled')).toBe(false)
  })

  it('drops an uploaded file when saved work is chosen instead', async () => {
    pendingAttachments = [
      {
        attachment_id: 'att-1',
        file_name: 'week-3-notes.docx',
        content_type:
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        attachment_kind: 'document',
        size_bytes: 24_000,
        status: 'ready',
      },
    ]
    listArtifacts.mockResolvedValue([lessonPlan])
    renderPage()

    // A pending upload still rides along with the generate call, so leaving it
    // attached would send the agent both sources at once — the exact mix this
    // form exists to prevent.
    await openSavedWork()
    await userEvent.click(screen.getByRole('radio', { name: /Week 3 — Test Doubles/ }))

    expect(removePendingAttachment).toHaveBeenCalledWith('att-1')
  })

  it('keeps the saved-work list out of the form until it is asked for', async () => {
    listArtifacts.mockResolvedValue([lessonPlan])
    renderPage()

    await waitFor(() => expect(listArtifacts).toHaveBeenCalled())
    expect(screen.queryByText('Week 3 — Test Doubles')).toBeNull()

    await openSavedWork()
    expect(screen.getByRole('radio', { name: /Week 3 — Test Doubles/ })).toBeTruthy()
  })

  it('closes the dialog on a pick and shows the chosen source on the form', async () => {
    listArtifacts.mockResolvedValue([lessonPlan])
    renderPage()
    await openSavedWork()
    await userEvent.click(screen.getByRole('radio', { name: /Week 3 — Test Doubles/ }))

    // Dialog gone, choice visible where the lecturer left off.
    expect(screen.queryByRole('radio')).toBeNull()
    expect(screen.getByText('Week 3 — Test Doubles')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Generate game/ }).hasAttribute('disabled')).toBe(false)
  })

  it('lets the lecturer take the source back off', async () => {
    listArtifacts.mockResolvedValue([lessonPlan])
    renderPage()
    await openSavedWork()
    await userEvent.click(screen.getByRole('radio', { name: /Week 3 — Test Doubles/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }))

    expect(screen.getByRole('button', { name: /Generate game/ }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: /Use saved work/ })).toBeTruthy()
  })
})
