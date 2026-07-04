import { describe, expect, it } from 'vitest'

import { normalizeRunRows } from './normalizeRunRows'
import type { AgentRunEvent } from '../../../../services/agentRunStream'

function event(overrides: Partial<AgentRunEvent>): AgentRunEvent {
  return {
    event_id: Math.random().toString(36).slice(2),
    kind: 'retrieval',
    status: 'success',
    title: '',
    created_at: 1,
    ...overrides,
  } as AgentRunEvent
}

describe('normalizeRunRows — attachment events', () => {
  it('renders a read event with a friendly title', () => {
    const rows = normalizeRunRows({}, [
      event({ event_type: 'attachment.read_done', summary: 'week3.pdf', created_at: 5 }),
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0].kind).toBe('retrieval')
    expect(rows[0].title).toBe('Reading attachment: week3.pdf')
  })

  it('renders a vision event distinctly', () => {
    const rows = normalizeRunRows({}, [
      event({ event_type: 'attachment.vision_done', summary: 'diagram.png' }),
    ])
    expect(rows[0].title).toBe('Analyzing image: diagram.png')
  })

  it('labels a refused read as skipped', () => {
    const rows = normalizeRunRows({}, [
      event({ event_type: 'attachment.read_refused', status: 'failed', summary: 'huge.pdf' }),
    ])
    expect(rows[0].title).toBe('Attachment skipped: huge.pdf')
    expect(rows[0].status).toBe('failed')
  })

  it('collapses started+done for one file into a single row', () => {
    const rows = normalizeRunRows({}, [
      event({ event_type: 'attachment.read_started', status: 'started', summary: 'week3.pdf', created_at: 1 }),
      event({ event_type: 'attachment.read_done', status: 'success', summary: 'week3.pdf', created_at: 2 }),
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0].status).toBe('done')
  })
})
