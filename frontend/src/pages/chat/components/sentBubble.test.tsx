// @vitest-environment jsdom

import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ChatMessagesPanel } from './ChatConversation'
import type { ChatMessage } from '../../../entity/Chat'

vi.mock('react-markdown', () => ({
  default: (props: { children?: unknown }) => <div>{String(props.children ?? '')}</div>,
}))
vi.mock('../../../services/authService', () => ({ startGoogleOAuth: vi.fn() }))

class FakeResizeObserver {
  observe() {}
  disconnect() {}
}

beforeEach(() => {
  ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = FakeResizeObserver
})
afterEach(() => {
  cleanup()
  delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver
})

const sent = (over: Partial<ChatMessage> = {}): ChatMessage => ({
  message_id: 'local-1',
  client_id: 'local-1',
  chat_id: 'c1',
  role: 'user',
  content: 'Can you make a quiz?',
  created_at: null,
  ...over,
})

function transcript(messages: ChatMessage[]) {
  return render(
    <ChatMessagesPanel
      messages={messages}
      messagesLoading={false}
      showWelcome={false}
      sending={false}
      runStates={{}}
      messagesEndRef={{ current: null }}
      welcomeContent={null}
      onApproveOutline={() => {}}
      onPendingEmailEdited={() => {}}
    />,
  )
}

/** The block holding the quote, the bubble and its attachments. Found through
 *  the bubble rather than by class, since the classes are what is asserted. */
const block = (container: HTMLElement) =>
  container.querySelector<HTMLElement>('.whitespace-pre-wrap')?.parentElement?.parentElement

describe('a message the lecturer just sent', () => {
  /**
   * The composer clears and the message exists — with nothing in between, which
   * is the one gesture in the app whose result simply appears at full size.
   */
  it('animates in', () => {
    const { container } = transcript([sent()])
    expect(block(container)?.className).toContain('mila-bubble-in')
  })

  /**
   * The entrance is triggered by the node being created, so tagging every user
   * message would replay the whole transcript on open — fifty bubbles rising at
   * once. `client_id` is set only by this browser's own send.
   */
  it('does not animate a message that came back from the server', () => {
    const { container } = transcript([sent({ client_id: undefined, message_id: 'srv-1' })])
    expect(block(container)?.className).not.toContain('mila-bubble-in')
  })

  /**
   * The row is keyed on `client_id`, so the backend's copy — same message, new
   * `message_id` — updates the bubble in place. Keyed on `message_id` the swap
   * unmounted it and built a new one, which replayed the entrance a beat after
   * it finished and re-probed every attachment thumbnail on the message.
   */
  it('survives the backend copy replacing it', () => {
    const { container, rerender } = transcript([sent()])
    const before = block(container)

    rerender(
      <ChatMessagesPanel
        messages={[sent({ message_id: 'server-99' })]}
        messagesLoading={false}
        showWelcome={false}
        sending={false}
        runStates={{}}
        messagesEndRef={{ current: null }}
        welcomeContent={null}
        onApproveOutline={() => {}}
        onPendingEmailEdited={() => {}}
      />,
    )

    // The same DOM node, not merely an equal one: a remount is what replays the
    // animation, and only node identity distinguishes the two.
    expect(block(container)).toBe(before)
  })

  /**
   * `max-w-full` here made the block shrink-to-fit, so the bubble's own
   * `max-w-[75%]` resolved against the width of the text it was wrapping —
   * three quarters of "as wide as I want to be" is always narrower than the
   * text, and a four-word message came out on two lines. Measured in Chromium:
   * "Can you make a quiz?" was 176px over 2 lines before, 199px over 1 after.
   * jsdom lays nothing out, so the class is the only thing assertable here.
   */
  it('measures its bubble against the column, not against its own text', () => {
    const { container } = transcript([sent()])
    expect(block(container)?.className).toContain('w-full')
    expect(block(container)?.className).not.toContain('max-w-full')
  })
})
