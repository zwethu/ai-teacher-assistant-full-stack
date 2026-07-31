// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ChatSidePanel } from './ChatSidePanel'

const listGames = vi.fn()

vi.mock('../../../services/gameService', () => ({
  listGames: (...args: unknown[]) => listGames(...args),
  deleteGame: vi.fn(),
}))

vi.mock('../../../services/chatService', () => ({
  listChatAttachments: vi.fn().mockResolvedValue([]),
  getChatAttachmentContent: vi.fn(),
  deleteChatAttachment: vi.fn(),
}))

afterEach(() => cleanup())
beforeEach(() => listGames.mockReset())

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
  items: [],
  itemCount: 8,
  modes: ['matching'],
  gameModeStats: {},
  status: 'active',
  contentHash: 'h',
  createdAt: '2026-07-26T10:00:00Z',
  expiresAt: inDays(30),
}

function renderPanel() {
  return render(
    <ChatSidePanel
      open
      onClose={() => {}}
      batchId="batch-1"
      chatId="chat-1"
      messages={[]}
      initialSection="games"
      onReferenceAttachment={() => {}}
    />,
  )
}

describe('ChatSidePanel — Games', () => {
  it('loads games for the batch, not the chat', async () => {
    listGames.mockResolvedValue([game])
    renderPanel()

    // chatId is 'chat-1' while the game came from 'chat-9' — the lookup is batch-scoped.
    await waitFor(() => expect(listGames).toHaveBeenCalledWith('batch-1'))
    expect(screen.getByText('Plant Biology')).toBeTruthy()
  })

  it('shows the pair count and the deadline, not the retention date', async () => {
    listGames.mockResolvedValue([{ ...game, deadlineAt: inDays(5) }])
    renderPanel()

    await waitFor(() => expect(screen.getByText(/8 pairs/)).toBeTruthy())
    expect(screen.getByText(/due /)).toBeTruthy()
    // expiresAt is a storage marker; surfacing it only muddied which date binds students.
    expect(screen.queryByText(/expires in/)).toBeNull()
  })

  it('singularises a one-pair game and marks a passed deadline', async () => {
    listGames.mockResolvedValue([
      { ...game, itemCount: 1, deadlineAt: inDays(-2) },
    ])
    renderPanel()

    await waitFor(() => expect(screen.getByText(/1 pair(?! s)/)).toBeTruthy())
    expect(screen.getByText(/closed /)).toBeTruthy()
  })

  it('says nothing about dates when the game has no deadline', async () => {
    listGames.mockResolvedValue([game])
    renderPanel()

    await waitFor(() => expect(screen.getByText(/8 pairs/)).toBeTruthy())
    expect(screen.queryByText(/due |closed /)).toBeNull()
  })

  it('tells the lecturer how to make one when the batch has none', async () => {
    listGames.mockResolvedValue([])
    renderPanel()

    await waitFor(() => expect(screen.getByText(/No games yet/)).toBeTruthy())
    expect(screen.getByText(/Study Game from the ⊕ menu/)).toBeTruthy()
  })
})
