// @vitest-environment jsdom

import { createRef, type ComponentProps } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ChatInput } from './ChatConversation'
import { MessageRow, parseUserMessageContent } from './MessageRow'
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
  content_type: 'image/png', size_bytes: 1000,
  scope: 'chat', attachment_kind: 'image',
  status: 'ready', token_estimate: 1290,
  parse_status: 'skipped', vision_status: 'ready',
  extracted_text_preview: '', vision_summary: 'A whiteboard', ocr_text: 'Week 1',
  expires_at: null, promoted_file_id: null, promotion_allowed: false,
  thumbnail_available: true, created_at: null, updated_at: null,
  rag_status: 'ready', chunk_status: 'ready', embedding_status: 'skipped',
  semantic_search_ready: false, chunk_count: 1, indexed_chars: 20,
  ocr_status: 'not_needed', rag_updated_at: null,
}

function renderInput(overrides: Partial<ComponentProps<typeof ChatInput>> = {}) {
  const props: ComponentProps<typeof ChatInput> = {
    input: '', sending: false, textareaRef: createRef<HTMLTextAreaElement>(),
    onInputChange: vi.fn(), onInputKeyDown: vi.fn(), onTextareaInput: vi.fn(),
    onSend: vi.fn(), connectors: { web_search: true }, onConnectorsChange: vi.fn(),
    activeGenerateMode: null, onSelectGenerateMode: vi.fn(), onClearGenerateMode: vi.fn(),
    pendingAttachments: [imageAttachment], referencedAttachments: [], attachmentsUploading: false,
    attachmentErrors: [], onAttachmentFiles: vi.fn(), onRemoveAttachment: vi.fn(),
    onReferenceAttachment: vi.fn(), onRemoveReferenced: vi.fn(),
    onPaste: vi.fn(),
    ...overrides,
  }
  render(<ChatInput {...props} />)
  return props
}

describe('parseUserMessageContent', () => {
  it('splits a referenced-attachment mention out of the visible body into a chip', () => {
    const { body, references } = parseUserMessageContent(
      'what about this\n\nPlease use the earlier attachment board.png. Attachment ID: image-1',
    )
    expect(body).toBe('what about this')
    expect(references).toEqual([{ title: 'board.png', id: 'image-1' }])
  })

  it('handles a referenced-only message (empty body) and multiple references', () => {
    const { body, references } = parseUserMessageContent(
      'Please use the earlier attachment a.pdf. Attachment ID: doc-1\nPlease use the earlier attachment b.png. Attachment ID: img-2',
    )
    expect(body).toBe('')
    expect(references).toHaveLength(2)
    expect(references[1]).toEqual({ title: 'b.png', id: 'img-2' })
  })

  it('leaves an ordinary message untouched', () => {
    const { body, references } = parseUserMessageContent('just a normal question')
    expect(body).toBe('just a normal question')
    expect(references).toEqual([])
  })
})

describe('chat attachment composer', () => {
  it('offers course-plan generation from the Generate menu', () => {
    const props = renderInput({ pendingAttachments: [] })
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }))
    fireEvent.click(screen.getByRole('button', { name: 'Course Plan' }))
    expect(props.onSelectGenerateMode).toHaveBeenCalledWith('course_blueprint')
  })

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

  it('lists safe previous attachments and references one as a chip (no textarea dump)', async () => {
    listChatAttachments.mockResolvedValueOnce([{
      attachment_id: 'doc-1', message_id: 'message-1', file_name: 'week-one.pdf',
      file_title: 'Week one', content_type: 'application/pdf', size_bytes: 2048,
      attachment_kind: 'document', status: 'ready', token_estimate: 516,
      parse_status: 'ready', vision_status: 'skipped',
      vision_source: 'none', thumbnail_available: false, created_at: '2026-01-01T00:00:00Z',
      expires_at: '2026-02-01T00:00:00Z',
      rag_status: 'ready', chunk_status: 'ready', embedding_status: 'skipped',
      semantic_search_ready: false, chunk_count: 2, indexed_chars: 2048,
      ocr_status: 'not_needed', rag_updated_at: '2026-01-01T00:00:00Z',
    }])
    const props = renderInput({ batchId: 'batch-1', chatId: 'chat-1', pendingAttachments: [] })
    fireEvent.click(screen.getByRole('button', { name: /Previous attachments/ }))
    await waitFor(() => expect(screen.getByText('Week one')).toBeTruthy())
    expect(screen.getByText(/available in this chat for 7 days/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Reference' }))
    expect(props.onReferenceAttachment).toHaveBeenCalledWith(expect.objectContaining({ attachment_id: 'doc-1' }))
    expect(props.onInputChange).not.toHaveBeenCalled()
    expect(screen.queryByText(/gs:\/\//)).toBeNull()
  })

  it('shows native processing state without storage paths', () => {
    renderInput({ pendingAttachments: [{ ...imageAttachment, attachment_kind: 'document', file_name: 'long.pdf', status: 'processing', vision_status: 'skipped' }] })
    expect(screen.getByText(/processing…/)).toBeTruthy()
    expect(screen.getByText(/still processing/)).toBeTruthy()
    expect(screen.queryByText(/gs:\/\//)).toBeNull()
  })

  it('flags an oversize file and blocks sending it', () => {
    renderInput({ pendingAttachments: [{ ...imageAttachment, attachment_kind: 'document', file_name: 'huge.pdf', status: 'too_large', vision_status: 'skipped' }] })
    expect(screen.getByText(/too large — add to Course Space/)).toBeTruthy()
    expect(screen.getByText(/Remove the flagged attachment/)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Send message' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('keeps historical image View and Ask actions separate without promotion', () => {
    const onAsk = vi.fn()
    render(<MessageRow batchId="batch-1" onAskAboutAttachment={onAsk} msg={{
      message_id: 'message-1', chat_id: 'chat-1', role: 'user', content: 'Screenshot',
      created_at: null, attachments: [imageAttachment],
    }} />)
    expect(screen.getByRole('button', { name: 'View' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Ask about image' }))
    expect(onAsk).toHaveBeenCalledWith(imageAttachment)
    expect(screen.queryByRole('button', { name: /promot/i })).toBeNull()
  })
})
