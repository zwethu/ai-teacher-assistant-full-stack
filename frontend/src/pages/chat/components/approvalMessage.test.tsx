// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ChatMessagesPanel } from './ChatConversation'
import { OutlineApprovalCard } from './MessageRow'
import type { ChatMessage } from '../../../entity/Chat'

vi.mock('react-markdown', () => ({
  default: (props: { children?: unknown }) => <div>{String(props.children ?? '')}</div>,
}))
vi.mock('../../../services/authService', () => ({ startGoogleOAuth: vi.fn() }))

afterEach(() => cleanup())

const outline: ChatMessage = {
  message_id: 'outline-1',
  chat_id: 'c1',
  role: 'assistant',
  content: 'Week 3 mocking lab, in four parts.',
  created_at: null,
  status: 'done',
  run_id: 'run-outline',
  metadata: {
    workflow_stage: 'outline',
    outline_approvable: true,
    outline_artifact_type: 'lab',
    outline_title: 'Mocking lab',
  },
}

function user(message_id: string, content: string, metadata?: Record<string, unknown>): ChatMessage {
  return { message_id, chat_id: 'c1', role: 'user', content, created_at: null, metadata }
}

function renderTranscript(messages: ChatMessage[]) {
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

describe('approval requests in the transcript', () => {
  it('leaves out the sentence the approval button composed', () => {
    renderTranscript([
      outline,
      user('u1', 'Approve this outline and generate the full lab preview.', { auto_generated: true }),
    ])

    expect(screen.queryByText(/Approve this outline and generate/)).toBeNull()
    // The turn still happened — the card the lecturer pressed is still there.
    expect(screen.getByText('Mocking lab')).toBeTruthy()
  })

  it('leaves out approvals from chats written before the flag existed', () => {
    // Same message, no metadata: everything already in Firestore looks like this.
    renderTranscript([outline, user('u1', 'Approve this outline and generate the full lab preview.')])

    expect(screen.queryByText(/Approve this outline and generate/)).toBeNull()
  })

  it('still shows a reply the lecturer typed', () => {
    renderTranscript([
      outline,
      user('u1', 'Approve this outline and generate the full lab preview.', { auto_generated: true }),
      user('u2', 'Shorten part 3 and add a debugging exercise.'),
    ])

    expect(screen.getByText('Shorten part 3 and add a debugging exercise.')).toBeTruthy()
  })

  it('covers every workflow, not just labs', () => {
    for (const label of ['lesson plan', 'assessment', 'course blueprint', '']) {
      renderTranscript([user('u1', `Approve this outline and generate the full ${label} preview.`)])
      expect(screen.queryByText(/Approve this outline and generate/)).toBeNull()
      cleanup()
    }
  })
})

describe('the approve button while its run is in flight', () => {
  const card = (generating: boolean, disabled = generating) =>
    render(
      <OutlineApprovalCard
        msg={outline}
        disabled={disabled}
        generating={generating}
        completed={false}
        superseded={false}
        onApprove={() => {}}
      />,
    )

  it('spins and says what it is doing', () => {
    const { container } = card(true)

    expect(screen.getByText('Generating full preview...')).toBeTruthy()
    expect(container.querySelector('.maia-btn__spin')).toBeTruthy()
  })

  it('does not spin merely because the chat is busy with something else', () => {
    // A plain follow-up message also disables the card. Reporting that as
    // "generating" would name work the lecturer never asked this card to do.
    const { container } = card(false, true)

    expect(screen.getByText('Approve and generate full preview')).toBeTruthy()
    expect(container.querySelector('.maia-btn__spin')).toBeNull()
  })
})
