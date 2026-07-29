// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ChatAttachmentListItem } from '../../../entity/Chat'
import { ChatSidePanel } from './ChatSidePanel'

const listChatAttachments = vi.fn()

vi.mock('../../../services/chatService', () => ({
  deleteChatAttachment: vi.fn(),
  getChatAttachmentContent: vi.fn(),
  listChatAttachments: (...args: unknown[]) => listChatAttachments(...args),
}))

afterEach(() => {
  cleanup()
  listChatAttachments.mockReset()
})

const imageAttachment: ChatAttachmentListItem = {
  attachment_id: 'image-1',
  message_id: 'message-1',
  file_name: 'schedule.png',
  file_title: 'schedule.png',
  content_type: 'image/png',
  size_bytes: 1000,
  attachment_kind: 'image',
  status: 'ready',
  token_estimate: 1290,
  parse_status: 'skipped',
  vision_status: 'ready',
  thumbnail_available: false,
  vision_source: 'bytes',
  rag_status: 'ready',
  chunk_status: 'ready',
  embedding_status: 'skipped',
  semantic_search_ready: false,
  chunk_count: 0,
  indexed_chars: 0,
  ocr_status: 'not_needed',
  rag_updated_at: null,
  created_at: null,
  expires_at: null,
}

describe('ChatSidePanel', () => {
  it('shows a loaded file and clears the loader after the file list changes from empty', async () => {
    listChatAttachments.mockResolvedValueOnce([imageAttachment])

    render(
      <ChatSidePanel
        open
        onClose={vi.fn()}
        batchId="batch-1"
        chatId="chat-1"
        messages={[]}
        initialSection="files"
        onReferenceAttachment={vi.fn()}
      />,
    )

    expect(await screen.findByText('schedule.png')).toBeTruthy()
    await waitFor(() => expect(screen.queryByText('Loading files…')).toBeNull())
    expect(listChatAttachments).toHaveBeenCalledTimes(1)
  })
})
