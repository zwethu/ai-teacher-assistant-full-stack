// @vitest-environment jsdom

import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ChatMessagesPanel } from './ChatConversation'
import type { ChatMessage } from '../../../entity/Chat'

vi.mock('react-markdown', () => ({
  default: (props: { children?: unknown }) => <div>{String(props.children ?? '')}</div>,
}))
vi.mock('../../../services/authService', () => ({ startGoogleOAuth: vi.fn() }))
vi.mock('../../../services/artifactService', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getArtifact: vi.fn(() => new Promise(() => {})),
}))

afterEach(() => {
  cleanup()
  counter = 0
})

class FakeResizeObserver {
  observe() {}
  disconnect() {}
}
;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = FakeResizeObserver

let counter = 0
const preview = (over: Partial<ChatMessage> & { week?: number } = {}): ChatMessage => {
  counter += 1
  const { week = 1, ...rest } = over
  return {
    message_id: `m${counter}`,
    chat_id: 'c1',
    role: 'assistant',
    content: `# Week ${week} draft ${counter}`,
    created_at: null,
    status: 'done',
    run_id: `run-${counter}`,
    metadata: {
      pending_artifact_type: 'lesson_plan',
      pending_exportable: true,
      week,
    },
    ...rest,
  }
}

function transcript(messages: ChatMessage[]) {
  return render(
    <ChatMessagesPanel
      batchId="b1"
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

const rowOf = (text: string) =>
  screen.getByRole('heading', { name: text }).closest('[data-quote-source]') as HTMLElement

describe('artifact preview cards when the draft is regenerated', () => {
  /**
   * Refining a draft leaves several preview cards for the same artifact in the
   * chat, and every one used to keep a live "Generate Google Doc" button — the
   * older card, clicked a week later, quietly exported the superseded draft.
   * Same rule the outline cards already follow: newest per (type, week) wins.
   */
  it('locks the export on every card but the newest of the same artifact', () => {
    transcript([preview(), preview()])

    const older = rowOf('Week 1 draft 1')
    const newer = rowOf('Week 1 draft 2')
    expect(within(older).queryByRole('button', { name: /Generate Google Doc/ })).toBeNull()
    expect(within(older).getByText(/Superseded — a newer draft/)).toBeTruthy()
    expect(within(newer).getByRole('button', { name: /Generate Google Doc/ })).toBeTruthy()
  })

  it('treats different weeks as different artifacts', () => {
    transcript([preview({ week: 1 }), preview({ week: 2 })])

    expect(screen.getAllByRole('button', { name: /Generate Google Doc/ })).toHaveLength(2)
    expect(screen.queryByText(/Superseded/)).toBeNull()
  })

  /**
   * An export that already happened is history, not a pending action — its
   * links stay. Only the un-exported button is suppressed.
   */
  it('keeps the links of an export that already happened', () => {
    const exported = preview()
    exported.metadata = { ...exported.metadata, doc_url: 'https://docs.example/old' }
    transcript([exported, preview()])

    const older = rowOf('Week 1 draft 1')
    expect(within(older).getByRole('link', { name: /Open Google Doc/ })).toBeTruthy()
    expect(within(older).queryByText(/Superseded/)).toBeNull()
  })
})
