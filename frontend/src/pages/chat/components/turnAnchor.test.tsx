// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
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

function user(id: string, content: string, metadata?: Record<string, unknown>): ChatMessage {
  return { message_id: id, chat_id: 'c1', role: 'user', content, created_at: null, metadata }
}
function assistant(id: string, content: string): ChatMessage {
  return { message_id: id, chat_id: 'c1', role: 'assistant', content, created_at: null, status: 'done' }
}

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

/** jsdom lays nothing out, so the box's min-height resolves to 0 and vanishes
 *  from the inline style. `data-current-turn` marks it regardless. */
const flooredBox = (container: HTMLElement) =>
  container.querySelector<HTMLElement>('[data-current-turn]')

describe('which turn gets anchored', () => {
  it('floors the newest question and everything after it', () => {
    const { container } = transcript([
      user('u1', 'First question'),
      assistant('a1', 'First answer'),
      user('u2', 'Second question'),
      assistant('a2', 'Second answer'),
    ])

    const box = flooredBox(container)
    expect(box?.textContent).toContain('Second question')
    expect(box?.textContent).toContain('Second answer')
    expect(box?.textContent).not.toContain('First question')
  })

  it('starts a new turn at a request the transcript does not render', () => {
    // Approving an outline sends a request that is deliberately hidden. Reading
    // the boundary off the visible list would put it back at "Plan week 3",
    // dragging the whole outline card into the turn — reliably taller than a
    // viewport, so the floor would go inert during exactly the generation it
    // exists to steady.
    const { container } = transcript([
      user('u1', 'Plan week 3'),
      assistant('a1', 'Here is the outline'),
      user('u2', 'Approve this outline and generate the full lab preview.', { auto_generated: true }),
      assistant('a2', 'Generating'),
    ])

    const box = flooredBox(container)
    expect(box?.textContent).toContain('Generating')
    expect(box?.textContent).not.toContain('Here is the outline')
    expect(box?.textContent).not.toContain('Plan week 3')
  })

  it('does not render the hidden request inside the turn it starts', () => {
    transcript([
      user('u1', 'Plan week 3'),
      assistant('a1', 'Here is the outline'),
      user('u2', 'Approve this outline and generate the full lab preview.', { auto_generated: true }),
    ])

    expect(screen.queryByText(/Approve this outline/)).toBeNull()
  })

  it('reserves the space the moment an approval is sent, not when it answers', () => {
    // The request is hidden, so nothing in the turn is visible yet — and for
    // the whole network round trip there is nothing else in it either. The box
    // still has to be there, or the space appears at the same moment the
    // loading mark does and the conversation lurches out from under it.
    const { container } = transcript([
      user('u1', 'Plan week 3'),
      assistant('a1', 'Here is the outline'),
      user('u2', 'Approve this outline and generate the full lab preview.', { auto_generated: true }),
    ])

    const box = flooredBox(container)
    expect(box).not.toBeNull()
    expect(box?.textContent).toBe('')
  })

  it('floors nothing in a chat that has no question yet', () => {
    const { container } = transcript([assistant('a1', 'Welcome')])

    expect(flooredBox(container)).toBeNull()
  })
})
