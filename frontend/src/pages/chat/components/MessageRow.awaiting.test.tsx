// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { MessageRow } from './MessageRow'
import type { RunUiState } from '../runTypes'

vi.mock('../../../services/chatService', () => ({
  listChatAttachments: vi.fn(),
  getChatAttachmentContent: vi.fn(),
}))

afterEach(() => cleanup())

function run(status: RunUiState['status']): RunUiState {
  return { status, events: [], steps: {} }
}

const pendingAssistant = {
  message_id: 'pending-run1', chat_id: 'chat-1', role: 'assistant' as const,
  content: '', created_at: null, status: 'pending' as const, run_id: 'run1', pending: true,
}

describe('MessageRow — awaiting_attachments', () => {
  it('shows "Processing your file(s)…" instead of the thinking indicator', () => {
    render(<MessageRow batchId="batch-1" msg={pendingAssistant} run={run('awaiting_attachments')} />)
    expect(screen.getByText(/Processing your file\(s\)/)).toBeTruthy()
  })

  it('shows the normal thinking flow once the run is running', () => {
    render(<MessageRow batchId="batch-1" msg={pendingAssistant} run={run('running')} />)
    expect(screen.queryByText(/Processing your file\(s\)/)).toBeNull()
  })
})
