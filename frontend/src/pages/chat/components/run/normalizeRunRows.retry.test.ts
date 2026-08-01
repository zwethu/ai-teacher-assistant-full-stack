import { describe, expect, it } from 'vitest'

import { normalizeRunRows } from './normalizeRunRows'
import type { AgentRunEvent } from '../../../../services/agentRunStream'

function processEvent(overrides: Partial<AgentRunEvent>): AgentRunEvent {
  return {
    event_id: Math.random().toString(36).slice(2),
    kind: 'process',
    phase: 'lab_full_generator',
    title: 'Writing the full lab',
    status: 'started',
    created_at: 1,
    ...overrides,
  } as AgentRunEvent
}

describe('normalizeRunRows — schema-retry status folding', () => {
  it('a phase that failed once then succeeded on retry ends Done', () => {
    const rows = normalizeRunRows({}, [
      processEvent({ status: 'started', created_at: 1 }),
      processEvent({ status: 'failed', title: 'lab_full_generator failed validation', created_at: 2 }),
      processEvent({ status: 'started', created_at: 3 }),
      processEvent({ status: 'done', created_at: 4 }),
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0].status).toBe('done')
    expect(rows[0].title).toBe('Writing the full lab')
  })

  it('a settled row is not downgraded by a stray late non-terminal event', () => {
    const rows = normalizeRunRows({}, [
      processEvent({ status: 'done', created_at: 1 }),
      processEvent({ status: 'running', created_at: 2 }),
    ])
    expect(rows[0].status).toBe('done')
  })

  it('a genuine later failure still replaces an earlier done', () => {
    const rows = normalizeRunRows({}, [
      processEvent({ status: 'done', created_at: 1 }),
      processEvent({ status: 'started', created_at: 2 }),
      processEvent({ status: 'failed', created_at: 3 }),
    ])
    expect(rows[0].status).toBe('failed')
  })
})
