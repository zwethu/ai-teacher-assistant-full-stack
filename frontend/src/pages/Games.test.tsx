// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

import Games from './Games'

const listGames = vi.fn()
const updateGame = vi.fn()
const useBatchSelection = vi.fn()

vi.mock('../services/gameService', () => ({
  listGames: (...args: unknown[]) => listGames(...args),
  deleteGame: vi.fn(),
  updateGame: (...args: unknown[]) => updateGame(...args),
  gamePlayUrl: (gameId: string) => `${window.location.origin}/play/${gameId}`,
}))

vi.mock('../hooks/useBatchSelection', () => ({
  useBatchSelection: () => useBatchSelection(),
}))

afterEach(() => cleanup())
beforeEach(() => {
  listGames.mockReset()
  updateGame.mockReset()
  useBatchSelection.mockReturnValue({
    batches: [{ id: 'batch-1', batch_name: 'Batch 2026', course_name: 'Software Testing' }],
    loading: false,
    selectedBatch: null,
    selectedBatchId: 'batch-1',
    setSelectedBatchId: vi.fn(),
  })
})

function inDays(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString()
}

const game = {
  gameId: 'game_abc',
  batchId: 'batch-1',
  lecturerId: 'lect-1',
  chatId: 'chat-9',
  runId: 'run-9',
  title: 'Plant Biology',
  items: [
    { term: 'Photosynthesis', definition: 'Converting light into chemical energy' },
    { term: 'Chlorophyll', definition: 'The green pigment that absorbs light' },
  ],
  itemCount: 2,
  modes: ['matching'],
  gameModeStats: {},
  status: 'active',
  contentHash: 'h',
  createdAt: '2026-07-26T10:00:00Z',
  expiresAt: inDays(30),
}

function renderPage() {
  return render(
    <MemoryRouter>
      <Games />
    </MemoryRouter>,
  )
}

describe('Games page', () => {
  it('lists games for the selected batch', async () => {
    listGames.mockResolvedValue([game])
    renderPage()

    await waitFor(() => expect(listGames).toHaveBeenCalledWith('batch-1'))
    expect(screen.getByText('Plant Biology')).toBeTruthy()
    expect(screen.getByText(/2 pairs/)).toBeTruthy()
  })

  it('keeps the pairs hidden until asked, then reveals them', async () => {
    listGames.mockResolvedValue([game])
    renderPage()

    await waitFor(() => expect(screen.getByText('Plant Biology')).toBeTruthy())
    expect(screen.queryByText('Photosynthesis')).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: /View pairs/ }))

    expect(screen.getByText('Photosynthesis')).toBeTruthy()
    expect(screen.getByText(/Converting light into chemical energy/)).toBeTruthy()
  })

  it('shows the deadline and hides the retention date', async () => {
    listGames.mockResolvedValue([{ ...game, deadlineAt: inDays(5) }])
    renderPage()

    await waitFor(() => expect(screen.getByText(/^Due /)).toBeTruthy())
    // expiresAt is storage bookkeeping — two dates on one row only raised the
    // question of which one students are actually held to.
    expect(screen.queryByText(/expires in/)).toBeNull()
  })

  it('offers to add a deadline to a game created without one', async () => {
    listGames.mockResolvedValue([game])
    renderPage()

    await waitFor(() => expect(screen.getByText('No deadline')).toBeTruthy())
    expect(screen.getByRole('button', { name: 'Set deadline' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull()
  })

  it('closes a live game on request and reflects the new state', async () => {
    listGames.mockResolvedValue([game])
    updateGame.mockResolvedValue({ ...game, status: 'closed' })
    renderPage()

    await waitFor(() => expect(screen.getByText('Plant Biology')).toBeTruthy())
    await userEvent.click(screen.getByRole('button', { name: /Close now/ }))

    await waitFor(() =>
      expect(updateGame).toHaveBeenCalledWith('batch-1', 'game_abc', { status: 'closed' }),
    )
    expect(screen.getByText('Closed')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Reopen/ })).toBeTruthy()
  })

  it('points the lecturer at the builder when the space has no games', async () => {
    listGames.mockResolvedValue([])
    renderPage()

    await waitFor(() => expect(screen.getByText(/No games in this space yet/)).toBeTruthy())
    expect(screen.getByText(/Use the panel above to build your first one/)).toBeTruthy()
  })

  it('offers space creation instead of an empty picker when there are no batches', async () => {
    useBatchSelection.mockReturnValue({
      batches: [],
      loading: false,
      selectedBatch: null,
      selectedBatchId: null,
      setSelectedBatchId: vi.fn(),
    })
    renderPage()

    expect(screen.getByRole('button', { name: /Create a space/ })).toBeTruthy()
    expect(listGames).not.toHaveBeenCalled()
  })
})
