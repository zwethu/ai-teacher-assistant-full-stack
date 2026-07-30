// @vitest-environment jsdom

import { createRef, type ComponentProps } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ChatInput } from './ChatConversation'
import { MessageRow } from './MessageRow'

vi.mock('../../../services/chatService', () => ({
  listChatAttachments: vi.fn(() => Promise.resolve([])),
  getChatAttachmentContent: vi.fn(() => Promise.resolve(new Blob())),
}))
vi.mock('../../../services/authService', () => ({ startGoogleOAuth: vi.fn() }))

afterEach(() => cleanup())

function inputProps(
  overrides: Partial<ComponentProps<typeof ChatInput>> = {},
): ComponentProps<typeof ChatInput> {
  return {
    input: '', sending: false, textareaRef: createRef<HTMLTextAreaElement>(),
    onInputChange: vi.fn(), onInputKeyDown: vi.fn(), onTextareaInput: vi.fn(),
    onSend: vi.fn(), connectors: { web_search: false }, onConnectorsChange: vi.fn(),
    activeGenerateMode: null, onSelectGenerateMode: vi.fn(), onClearGenerateMode: vi.fn(),
    pendingAttachments: [], referencedAttachments: [], attachmentsUploading: false,
    attachmentErrors: [], onAttachmentFiles: vi.fn(), onRemoveAttachment: vi.fn(),
    onRemoveReferenced: vi.fn(), onPaste: vi.fn(),
    ...overrides,
  }
}

describe('quote-reply flow', () => {
  it('shows the quoted passage in the composer once one is set', () => {
    render(<ChatInput {...inputProps({ quotedReply: 'exported to Google Forms' })} />)

    expect(screen.getByText('exported to Google Forms')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Remove quoted text' })).toBeTruthy()
  })

  it('drops the quote when the composer chip is dismissed', () => {
    const onClearQuotedReply = vi.fn()
    render(<ChatInput {...inputProps({ quotedReply: 'some passage', onClearQuotedReply })} />)

    fireEvent.click(screen.getByRole('button', { name: 'Remove quoted text' }))
    expect(onClearQuotedReply).toHaveBeenCalledTimes(1)
  })

  it('hands the selected text to the composer when Reply is tapped', () => {
    // The button only exists while a selection is live, so the selection has to
    // be simulated before mouseup — this is the path the lecturer takes.
    const onQuoteReply = vi.fn()
    const { container } = render(
      <MessageRow
        batchId="b1"
        onQuoteReply={onQuoteReply}
        msg={{
          message_id: 'm1', chat_id: 'c1', role: 'assistant',
          content: 'Quizzes and tests, exported to Google Forms.',
          created_at: null, status: 'done',
        }}
      />,
    )

    const body = container.querySelector('[data-quote-source]') as HTMLElement
    expect(body, 'assistant content is not marked as a quote source').toBeTruthy()

    const textNode = body.querySelector('p')?.firstChild
    const range = document.createRange()
    range.setStart(textNode!, 0)
    range.setEnd(textNode!, 7)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)

    fireEvent.mouseUp(body)

    // The real sequence: pressing the button dispatches mousedown first. The
    // button is portalled outside the message, so a dismiss-on-outside-click
    // handler will unmount it here unless it excludes the button itself — and
    // then the click never lands.
    const reply = screen.getByRole('button', { name: 'Reply' })
    fireEvent.mouseDown(reply)
    fireEvent.click(reply)

    expect(onQuoteReply).toHaveBeenCalledTimes(1)
    expect(onQuoteReply.mock.calls[0][0]).toContain('Quizzes')
  })
})
