// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

import Games from './Games'

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

    await waitFor(() => expect(screen.getByText('Week 3 — Test Doubles')).toBeTruthy())
    expect(screen.getByText('Week 4 Lab')).toBeTruthy()
    expect(screen.queryByText('Course Plan')).toBeNull()
  })

  it('sends the artifact type and week so the agent reads the right saved work', async () => {
    listArtifacts.mockResolvedValue([lessonPlan])
    renderPage()

    await waitFor(() => expect(screen.getByText('Week 3 — Test Doubles')).toBeTruthy())
    await userEvent.click(screen.getByRole('button', { name: /Week 3 — Test Doubles/ }))
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

    await waitFor(() => expect(screen.getByText('Week 3 — Test Doubles')).toBeTruthy())
    const field = screen.getByLabelText('Number of pairs') as HTMLInputElement
    expect(field.value).toBe('30')
    // 30 seconds a pair — the standard 30-pair game is a 15-minute round.
    expect(screen.getByText('About 15 min to play')).toBeTruthy()

    await userEvent.clear(field)
    await userEvent.type(field, '12')
    await userEvent.click(screen.getByRole('button', { name: /Week 3 — Test Doubles/ }))
    await userEvent.click(screen.getByRole('button', { name: /Generate game/ }))

    await waitFor(() => expect(generate).toHaveBeenCalled())
    expect(generate.mock.calls[0][0].message).toContain('exactly 12 term/definition pairs')
  })

  it('refuses a pair count the backend would reject', async () => {
    listArtifacts.mockResolvedValue([lessonPlan])
    renderPage()

    await waitFor(() => expect(screen.getByText('Week 3 — Test Doubles')).toBeTruthy())
    await userEvent.click(screen.getByRole('button', { name: /Week 3 — Test Doubles/ }))
    const field = screen.getByLabelText('Number of pairs')
    await userEvent.clear(field)
    await userEvent.type(field, '99')

    expect(screen.getByText('Pick between 4 and 40')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Generate game/ }).hasAttribute('disabled')).toBe(true)
  })

  it('drops an uploaded file when saved work is picked instead', async () => {
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

    await waitFor(() => expect(screen.getByText('Week 3 — Test Doubles')).toBeTruthy())
    await userEvent.click(screen.getByRole('button', { name: /Week 3 — Test Doubles/ }))

    expect(removePendingAttachment).toHaveBeenCalledWith('att-1')
  })
})
