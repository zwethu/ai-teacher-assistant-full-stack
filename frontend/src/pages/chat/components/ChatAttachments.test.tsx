// @vitest-environment jsdom

import { createRef, type ComponentProps } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ChatInput } from './ChatConversation'
import type { PendingChatAttachment } from '../hooks/useChatPage'

const listChatAttachments = vi.fn()
vi.mock('../../../services/chatService', () => ({
  listChatAttachments: (...args: unknown[]) => listChatAttachments(...args),
  getChatAttachmentContent: vi.fn(),
}))

afterEach(() => cleanup())

const imageAttachment: PendingChatAttachment = {
  attachment_id: 'image-1', batch_id: 'batch-1', chat_id: 'chat-1', message_id: null,
  lecturer_id: 'lecturer-1', file_name: 'board.png', file_title: 'board.png',
  content_type: 'image/png', size_bytes: 1000, gcs_path: 'gs://bucket/board.png',
  thumbnail_gcs_path: 'gs://bucket/thumb.jpg', scope: 'chat', attachment_kind: 'image',
  parse_status: 'skipped', vision_status: 'ready', extracted_text_path: null,
  extracted_text_preview: '', vision_summary: 'A whiteboard', ocr_text: 'Week 1',
  expires_at: null, promoted_file_id: null, promotion_allowed: false,
  thumbnail_available: true, created_at: null, updated_at: null,
}

function renderInput(overrides: Partial<ComponentProps<typeof ChatInput>> = {}) {
  const props: ComponentProps<typeof ChatInput> = {
    input: '', sending: false, textareaRef: createRef<HTMLTextAreaElement>(),
    onInputChange: vi.fn(), onInputKeyDown: vi.fn(), onTextareaInput: vi.fn(),
    onSend: vi.fn(), connectors: { web_search: true }, onConnectorsChange: vi.fn(),
    activeGenerateMode: null, onSelectGenerateMode: vi.fn(), onClearGenerateMode: vi.fn(),
    pendingAttachments: [imageAttachment], attachmentsUploading: false,
    attachmentErrors: [], onAttachmentFiles: vi.fn(), onRemoveAttachment: vi.fn(),
    onPaste: vi.fn(),
    ...overrides,
  }
  render(<ChatInput {...props} />)
  return props
}

describe('chat attachment composer', () => {
  it('shows chat-only images, allows attachment-only send, and removes a chip', () => {
    const props = renderInput()
    expect(screen.getByText('board.png')).toBeTruthy()
    expect(screen.getByText(/chat-only/)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Send message' }) as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Remove board.png' }))
    expect(props.onRemoveAttachment).toHaveBeenCalledWith('image-1')
  })

  it('disables send and file selection while an upload is active', () => {
    renderInput({ pendingAttachments: [], attachmentsUploading: true })
    expect((screen.getByRole('button', { name: 'Send message' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Attach files' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('lists safe previous attachments and inserts a reference', async () => {
    listChatAttachments.mockResolvedValueOnce([{
      attachment_id: 'doc-1', message_id: 'message-1', file_name: 'week-one.pdf',
      file_title: 'Week one', content_type: 'application/pdf', size_bytes: 2048,
      attachment_kind: 'document', parse_status: 'ready', vision_status: 'skipped',
      vision_source: 'none', thumbnail_available: false, created_at: '2026-01-01T00:00:00Z',
      expires_at: '2026-02-01T00:00:00Z',
    }])
    const props = renderInput({ batchId: 'batch-1', chatId: 'chat-1', pendingAttachments: [] })
    fireEvent.click(screen.getByRole('button', { name: /Previous attachments/ }))
    await waitFor(() => expect(screen.getByText('Week one')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Reference' }))
    expect(props.onInputChange).toHaveBeenCalledWith(expect.stringContaining('Attachment ID: doc-1'))
    expect(screen.queryByText(/gs:\/\//)).toBeNull()
  })
})
