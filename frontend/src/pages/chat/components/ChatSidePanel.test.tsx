// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ChatAttachmentListItem } from '../../../entity/Chat'
import { ChatSidePanel } from './ChatSidePanel'

const listChatAttachments = vi.fn()
const getChatAttachmentContent = vi.fn()

vi.mock('../../../services/chatService', () => ({
  deleteChatAttachment: vi.fn(),
  getChatAttachmentContent: (...args: unknown[]) => getChatAttachmentContent(...args),
  listChatAttachments: (...args: unknown[]) => listChatAttachments(...args),
}))

afterEach(() => {
  cleanup()
  listChatAttachments.mockReset()
  getChatAttachmentContent.mockReset()
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

  it('clears the loader even when thumbnails are fetched afterwards', async () => {
    // The regression: fetching a thumbnail awaits AFTER setItems, so the effect
    // (which depended on items.length) re-ran, cancelled the in-flight load,
    // and its `finally` skipped setLoading(false) because `cancelled` was true.
    // The re-run then bailed on the loaded-key guard, so the spinner never
    // cleared. Only reproducible when there is a thumbnail to fetch.
    listChatAttachments.mockResolvedValueOnce([
      { ...imageAttachment, thumbnail_available: true },
    ])
    getChatAttachmentContent.mockResolvedValue(new Blob(['x'], { type: 'image/png' }))

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
    // And the list is fetched once, not on a loop.
    expect(listChatAttachments).toHaveBeenCalledTimes(1)
  })
})
