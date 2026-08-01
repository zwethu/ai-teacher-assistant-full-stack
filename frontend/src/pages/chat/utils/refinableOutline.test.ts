import { describe, expect, it } from 'vitest'

import type { ChatMessage } from '../../../entity/Chat'
import { findRefinableOutline, refineModeForOutline } from './refinableOutline'

let id = 0
function msg(overrides: Partial<ChatMessage>): ChatMessage {
  id += 1
  return {
    message_id: `m${id}`,
    chat_id: 'c1',
    role: 'assistant',
    content: 'text',
    created_at: new Date(2026, 0, id).toISOString(),
    ...overrides,
  } as ChatMessage
}

function outlineMsg(runId: string, type = 'quiz'): ChatMessage {
  return msg({
    run_id: runId,
    metadata: {
      workflow_stage: 'outline',
      outline_approvable: true,
      outline_artifact_type: type,
      week: 2,
    },
  })
}

describe('findRefinableOutline', () => {
  it('targets the awaiting outline at the end of the chat', () => {
    const messages = [
      msg({ role: 'user', content: 'make a quiz' }),
      outlineMsg('run_1'),
    ]
    expect(findRefinableOutline(messages)?.run_id).toBe('run_1')
  })

  it('returns null once a real user follow-up superseded the outline', () => {
    const messages = [
      outlineMsg('run_1'),
      msg({ role: 'user', content: 'unrelated question' }),
      msg({ role: 'assistant', content: 'answer' }),
    ]
    expect(findRefinableOutline(messages)).toBeNull()
  })

  it('ignores the auto-issued approval message but respects its approval', () => {
    const messages = [
      outlineMsg('run_1'),
      msg({ role: 'user', content: 'Approve this outline and generate the full assessment preview.', metadata: { auto_generated: true } }),
      msg({ role: 'assistant', content: 'full quiz', metadata: { approved_outline_run_id: 'run_1' } }),
    ]
    expect(findRefinableOutline(messages)).toBeNull()
  })

  it('targets a revised outline even after an earlier one was superseded', () => {
    const messages = [
      outlineMsg('run_1'),
      msg({ role: 'user', content: 'only multiple choices' }),
      outlineMsg('run_2'),
    ]
    expect(findRefinableOutline(messages)?.run_id).toBe('run_2')
  })

  it('returns null when the chat has no outline', () => {
    const messages = [
      msg({ role: 'user', content: 'hello' }),
      msg({ role: 'assistant', content: 'hi' }),
    ]
    expect(findRefinableOutline(messages)).toBeNull()
  })
})

describe('refineModeForOutline', () => {
  it('maps quiz to the assessment workflow and passes others through', () => {
    expect(refineModeForOutline(outlineMsg('r', 'quiz'))).toBe('assessment')
    expect(refineModeForOutline(outlineMsg('r', 'lab'))).toBe('lab')
    expect(refineModeForOutline(outlineMsg('r', 'course_blueprint'))).toBe('course_blueprint')
    expect(refineModeForOutline(outlineMsg('r', 'mystery'))).toBe('')
  })
})
