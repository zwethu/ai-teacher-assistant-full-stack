// @vitest-environment jsdom

import { createRef, type ComponentProps } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ChatInput } from './ChatConversation'
import { MessageRow, parseUserMessageContent } from './MessageRow'
import type { PendingChatAttachment } from '../hooks/useChatPage'

const listChatAttachments = vi.fn()
vi.mock('../../../services/chatService', () => ({
  listChatAttachments: (...args: unknown[]) => listChatAttachments(...args),
  // resolves like the real service: previews probe availability by loading
  getChatAttachmentContent: vi.fn(() => Promise.resolve(new Blob())),
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
    attachmentErrors: [],     onAttachmentFiles: vi.fn(), onRemoveAttachment: vi.fn(),
    onRemoveReferenced: vi.fn(),
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
  it('offers course-plan generation from the + menu', () => {
    const props = renderInput({ pendingAttachments: [] })
    fireEvent.click(screen.getByRole('button', { name: /Add files, generate/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Course Plan' }))
    expect(props.onSelectGenerateMode).toHaveBeenCalledWith('course_blueprint')
  })

  it('shows a pending attachment as a preview-only tile and removes it', () => {
    const props = renderInput()
    // Preview only: the name and readiness moved into the tooltip so the image
    // itself gets the space. Neither is printed on the tile.
    expect(screen.queryByText('board.png')).toBeNull()
    expect(screen.queryByText(/chat-only/)).toBeNull()
    const tile = screen.getByRole('button', { name: 'Preview board.png' })
    expect(tile.getAttribute('title')).toContain('board.png')
    expect(tile.getAttribute('title')).toContain('chat-only')
    expect((screen.getByRole('button', { name: 'Send message' }) as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Remove board.png' }))
    expect(props.onRemoveAttachment).toHaveBeenCalledWith('image-1')
  })

  it('disables send and file selection while an upload is active', () => {
    renderInput({ pendingAttachments: [], attachmentsUploading: true })
    expect((screen.getByRole('button', { name: 'Send message' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: /Add files, generate/ }))
    expect((screen.getByRole('menuitem', { name: 'Add files or photos' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('opens the files panel from Previous attachments instead of an inline popover', () => {
    const onOpenFilesPanel = vi.fn()
    renderInput({
      batchId: 'batch-1',
      chatId: 'chat-1',
      pendingAttachments: [],
      onOpenFilesPanel,
    })
    fireEvent.click(screen.getByRole('button', { name: /Add files, generate/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Previous attachments/ }))
    expect(onOpenFilesPanel).toHaveBeenCalledTimes(1)
    expect(screen.queryByText(/available in this chat for 7 days/)).toBeNull()
    expect(listChatAttachments).not.toHaveBeenCalled()
  })

  it('shows native processing state without storage paths', () => {
    renderInput({ pendingAttachments: [{ ...imageAttachment, attachment_kind: 'document', file_name: 'long.pdf', status: 'processing', vision_status: 'skipped' }] })
    // The tile carries it as a tooltip; the composer still says it in words.
    expect(screen.getByRole('button', { name: 'Preview long.pdf' }).getAttribute('title'))
      .toContain('processing…')
    expect(screen.getByText(/still processing/)).toBeTruthy()
    expect(screen.queryByText(/gs:\/\//)).toBeNull()
  })

  it('flags an oversize file and blocks sending it', () => {
    renderInput({ pendingAttachments: [{ ...imageAttachment, attachment_kind: 'document', file_name: 'huge.pdf', status: 'too_large', vision_status: 'skipped' }] })
    // A rejected file must stay identifiable without a caption: red ring on the
    // tile, reason in the tooltip, and the composer-level instruction below it.
    const tile = screen.getByRole('button', { name: 'Preview huge.pdf' })
    expect(tile.getAttribute('title')).toContain('too large — add to Course Space')
    expect(tile.className).toContain('border-red-300')
    expect(screen.getByText(/Remove the flagged attachment/)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Send message' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('shows a sent attachment as a bare preview, with no filename or extra actions', () => {
    render(<MessageRow batchId="batch-1" msg={{
      message_id: 'message-1', chat_id: 'chat-1', role: 'user', content: 'Screenshot',
      created_at: null, attachments: [imageAttachment],
    }} />)
    // The thumbnail is the whole control: tapping it opens the viewer.
    expect(screen.getByRole('button', { name: /Preview / })).toBeTruthy()
    // Everything that used to sit beside it is gone.
    expect(screen.queryByRole('button', { name: 'View' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Ask about/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /promot/i })).toBeNull()
    expect(screen.queryByText(imageAttachment.file_name)).toBeNull()
  })
})
