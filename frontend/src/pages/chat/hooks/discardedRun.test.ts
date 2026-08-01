import { describe, expect, it } from 'vitest'

import { collectRunIds } from './useChatPage'
import type { Chat, ChatMessage } from '../../../entity/Chat'

/**
 * Retrying deletes the turn it is replacing. The run behind it must not come
 * back — and the chat record alone is not enough to stop it, because the
 * backend deliberately leaves `active_run_id` set after a run ends.
 *
 * With the assistant message deleted, the resubscribe effect finds no message
 * for that run and appends a fresh pending placeholder, which renders a
 * thinking line and a step panel for a run nothing is listening to. It hangs
 * above the retry forever. Clearing the chat's pointers is what keeps the run
 * out of the subscription set in the first place.
 */
function chat(overrides: Partial<Chat> = {}): Chat {
  return {
    chat_id: 'c1',
    batch_id: 'b1',
    lecturer_id: 'lect-1',
    title: 'Chat',
    created_at: null,
    updated_at: null,
    ...overrides,
  }
}

function assistant(run_id: string): ChatMessage {
  return { message_id: `m-${run_id}`, chat_id: 'c1', role: 'assistant', content: 'x', created_at: null, run_id }
}

describe('runs a retry has thrown away', () => {
  it('drops out of the subscription set once the chat forgets them', () => {
    const discarded = chat({ active_run_id: '', last_run_id: '' })

    expect(collectRunIds([], discarded)).toEqual([])
  })

  it('would otherwise be collected from the chat record alone', () => {
    // The failing shape: no messages left for the run, but the chat still
    // points at it — which is what resurrects it as a pending placeholder.
    const stale = chat({ active_run_id: 'run-old' })

    expect(collectRunIds([], stale)).toContain('run-old')
  })

  it('keeps collecting runs that still have a message', () => {
    // Clearing the pointers must not cost us the subscriptions for turns that
    // are genuinely still on screen.
    const cleared = chat({ active_run_id: '', last_run_id: '' })

    expect(collectRunIds([assistant('run-a'), assistant('run-b')], cleared)).toEqual([
      'run-a',
      'run-b',
    ])
  })

  it('still falls back to last_run_id for an assistant message that has none', () => {
    // A message written before run ids were recorded. Clearing on retry only
    // targets the discarded id, so this path is untouched.
    const withPointer = chat({ last_run_id: 'run-legacy' })
    const legacy: ChatMessage = {
      message_id: 'm-legacy', chat_id: 'c1', role: 'assistant', content: 'x', created_at: null,
    }

    expect(collectRunIds([legacy], withPointer)).toContain('run-legacy')
  })
})
