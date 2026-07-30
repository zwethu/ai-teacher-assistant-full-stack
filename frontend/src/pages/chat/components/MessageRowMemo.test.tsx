// @vitest-environment jsdom

import { useState } from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { MessageRow } from './MessageRow'
import type { ChatMessage } from '../../../entity/Chat'

/**
 * The transcript re-renders on every frame of the composer's height transition,
 * because the measured height becomes the scroll container's bottom padding.
 * Without the memo that means re-parsing every message's Markdown ~15 times per
 * attach, so this counts real renders rather than asserting the wrapper exists.
 */

const markdownRenders = vi.fn()

vi.mock('react-markdown', () => ({
  default: (props: { children?: unknown }) => {
    markdownRenders()
    return <div>{String(props.children ?? '')}</div>
  },
}))

vi.mock('../../../services/authService', () => ({ startGoogleOAuth: vi.fn() }))

beforeEach(() => markdownRenders.mockClear())
afterEach(() => cleanup())

const message: ChatMessage = {
  message_id: 'm1', chat_id: 'c1', role: 'assistant',
  content: 'Here is your lesson plan.', created_at: null, status: 'done',
}

/** Stands in for ChatLayout: re-renders on its own state, as it does when the
 *  composer's measured height changes, while the message props stay put. */
function Transcript({ onRetry }: { onRetry: (msg: ChatMessage) => void }) {
  const [inset, setInset] = useState(0)
  return (
    <div style={{ paddingBottom: inset }}>
      <button onClick={() => setInset((value) => value + 1)}>grow</button>
      <MessageRow msg={message} batchId="b1" onRetry={onRetry} />
    </div>
  )
}

describe('MessageRow render cost', () => {
  it('does not re-render when only the composer height changed', () => {
    const onRetry = vi.fn()
    render(<Transcript onRetry={onRetry} />)
    const initial = markdownRenders.mock.calls.length
    expect(initial).toBeGreaterThan(0)

    // Ten frames' worth of composer growth.
    for (let frame = 0; frame < 10; frame += 1) {
      act(() => screen.getByText('grow').click())
    }

    expect(markdownRenders.mock.calls.length).toBe(initial)
  })

  it('still re-renders when the message itself changes', () => {
    // The memo must not be so aggressive that a streamed update is swallowed.
    const { rerender } = render(<MessageRow msg={message} batchId="b1" />)
    const initial = markdownRenders.mock.calls.length

    rerender(<MessageRow msg={{ ...message, content: 'Updated plan.' }} batchId="b1" />)

    expect(markdownRenders.mock.calls.length).toBeGreaterThan(initial)
    expect(screen.getByText('Updated plan.')).toBeTruthy()
  })
})
