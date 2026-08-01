// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AgentRunEvent } from '../../../../services/agentRunStream'
import type { ChatMessage } from '../../../../entity/Chat'
import { MessageRow } from '../MessageRow'

vi.mock('react-markdown', () => ({
  default: (props: { children?: unknown }) => <div>{String(props.children ?? '')}</div>,
}))
vi.mock('../../../../services/authService', () => ({ startGoogleOAuth: vi.fn() }))

afterEach(() => cleanup())

/**
 * The thinking line is a fixed-height, always-present liveness signal; the step
 * list changes height on every arrival and departure. With the steps above it,
 * the garland — the one thing the eye rests on during a run — was displaced by
 * every step that came or went.
 */
const message: ChatMessage = {
  message_id: 'm1',
  chat_id: 'c1',
  role: 'assistant',
  content: '',
  created_at: null,
  status: 'pending',
  run_id: 'run-1',
  pending: true,
}

function event(overrides: Partial<AgentRunEvent>): AgentRunEvent {
  return {
    event_id: `e-${overrides.title ?? 'x'}`,
    kind: 'tool',
    status: 'running',
    title: '',
    created_at: 1,
    ...overrides,
  } as AgentRunEvent
}

describe('the run surface during a live run', () => {
  it('puts the thinking line above the steps', () => {
    const { container } = render(
      <MessageRow
        msg={message}
        run={{
          status: 'running',
          steps: {},
          events: [
            event({ kind: 'thinking', summary: 'Weighing two framings' }),
            event({ tool_call_id: 'a', title: 'Checking saved materials', status: 'started' }),
          ],
        }}
      />,
    )

    const thinking = screen.getByText('Weighing two framings')
    const step = screen.getByText('Checking saved materials')

    // DOCUMENT_POSITION_FOLLOWING: the step comes after the thinking line.
    expect(thinking.compareDocumentPosition(step) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(container).toBeTruthy()
  })

  it('still shows both, so the reorder did not drop one', () => {
    render(
      <MessageRow
        msg={message}
        run={{
          status: 'running',
          steps: {},
          events: [
            event({ kind: 'thinking', summary: 'Weighing two framings' }),
            event({ tool_call_id: 'a', title: 'Checking saved materials', status: 'started' }),
          ],
        }}
      />,
    )

    expect(screen.getByText('Weighing two framings')).toBeTruthy()
    expect(screen.getByText('Checking saved materials')).toBeTruthy()
  })
})
