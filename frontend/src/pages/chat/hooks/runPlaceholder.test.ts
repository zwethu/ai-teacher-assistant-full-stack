import { describe, expect, it } from 'vitest'
import { runHasAssistantMessage } from './useChatPage'
import type { ChatMessage } from '../../../entity/Chat'

function message(partial: Partial<ChatMessage>): ChatMessage {
  return {
    message_id: 'm', chat_id: 'c1', role: 'assistant', content: '',
    created_at: null, ...partial,
  } as ChatMessage
}

describe('runHasAssistantMessage', () => {
  it('is false for a run that has not answered yet', () => {
    const messages = [message({ message_id: 'u1', role: 'user', content: 'Hi' })]
    expect(runHasAssistantMessage(messages, 'run-1')).toBe(false)
  })

  it('recognises the pending placeholder', () => {
    const messages = [message({ message_id: 'pending-run-1', run_id: 'run-1', pending: true })]
    expect(runHasAssistantMessage(messages, 'run-1')).toBe(true)
  })

  it('recognises a SETTLED answer, so no ghost placeholder is appended', () => {
    // The regression: a finished run whose message is no longer `pending` used
    // to look answer-less, and a second empty assistant row was appended —
    // rendering as a stray "Completed N steps" block below the real response.
    const messages = [
      message({ message_id: 'u1', role: 'user', content: 'Explain testing' }),
      message({ message_id: 'a1', run_id: 'run-1', content: 'Here you go.', pending: false }),
    ]
    expect(runHasAssistantMessage(messages, 'run-1')).toBe(true)
  })

  it('does not confuse a different run', () => {
    const messages = [message({ message_id: 'a1', run_id: 'run-2', content: 'Other answer' })]
    expect(runHasAssistantMessage(messages, 'run-1')).toBe(false)
  })

  it('ignores the user message that belongs to the run', () => {
    const messages = [message({ message_id: 'u1', role: 'user', run_id: 'run-1', content: 'Hi' })]
    expect(runHasAssistantMessage(messages, 'run-1')).toBe(false)
  })
})
