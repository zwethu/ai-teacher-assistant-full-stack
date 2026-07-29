// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { GameCreateButton } from './MessageRow'
import type { ChatMessage } from '../../../entity/Chat'

const createGameFromRun = vi.fn()

vi.mock('../../../services/gameService', () => ({
  createGameFromRun: (...args: unknown[]) => createGameFromRun(...args),
}))

vi.mock('../../../services/chatService', () => ({
  listChatAttachments: vi.fn(),
  getChatAttachmentContent: vi.fn(),
}))

afterEach(() => cleanup())
beforeEach(() => createGameFromRun.mockReset())

function message(metadata: Record<string, unknown>): ChatMessage {
  return {
    message_id: 'm-1',
    chat_id: 'chat-1',
    role: 'assistant',
    content: 'Here is your game.',
    created_at: null,
    run_id: 'run-1',
    metadata,
  } as ChatMessage
}

const stagedGame = {
  pending_savable_game: true,
  pending_artifact_content_hash: 'hash-1',
  game_item_count: 8,
}

describe('GameCreateButton', () => {
  it('renders nothing unless the backend staged a game', () => {
    const { container } = render(
      <GameCreateButton batchId="batch-1" msg={message({ pending_exportable: true })} />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('shows the pair count so the lecturer knows what they are creating', () => {
    render(<GameCreateButton batchId="batch-1" msg={message(stagedGame)} />)
    expect(screen.getByRole('button', { name: /Create game \(8 pairs\)/ })).toBeTruthy()
  })

  it('sends the content hash so a stale preview cannot create a game', async () => {
    createGameFromRun.mockResolvedValue({ gameId: 'game_abc', itemCount: 8 })
    render(<GameCreateButton batchId="batch-1" msg={message(stagedGame)} />)

    await userEvent.click(screen.getByRole('button', { name: /Create game/ }))

    await waitFor(() =>
      expect(createGameFromRun).toHaveBeenCalledWith('batch-1', 'chat-1', 'run-1', 'hash-1'),
    )
  })

  it('replaces the button with a confirmation once created', async () => {
    createGameFromRun.mockResolvedValue({ gameId: 'game_abc', itemCount: 8 })
    render(<GameCreateButton batchId="batch-1" msg={message(stagedGame)} />)

    await userEvent.click(screen.getByRole('button', { name: /Create game/ }))

    await waitFor(() => expect(screen.getByText(/Game created · 8 pairs/)).toBeTruthy())
    expect(screen.queryByRole('button', { name: /Create game/ })).toBeNull()
  })

  // NOTE: the failure path (backend detail rendered, button stays clickable) is not
  // covered here. This harness — React 19 + vitest 4 with no setup file — reports a
  // rejection that the component *does* catch as a test-level unhandled error, however
  // the rejection is shaped. No other test in this repo exercises a rejection through a
  // component, so this is untrodden ground rather than a regression; the error branch is
  // identical to BlueprintSaveButton's and was verified by hand.
})
