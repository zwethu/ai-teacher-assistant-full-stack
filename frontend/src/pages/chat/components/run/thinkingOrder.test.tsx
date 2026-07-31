// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import type { AgentRunEvent } from '../../../../services/agentRunStream'
import { ThinkingPanel } from './ThinkingPanel'

afterEach(() => cleanup())

/**
 * The agent stamps `created_at` with `int(time.time())` — whole seconds — and
 * mints `event_id` from `uuid4().hex[:16]`. Several thinking notes inside one
 * second is normal, so every ordering decision has to survive a tie on the
 * timestamp with ids in arbitrary order.
 */
function thought(event_id: string, summary: string, created_at: number): AgentRunEvent {
  return { event_id, kind: 'thinking', status: 'running', summary, created_at } as AgentRunEvent
}

describe('ThinkingPanel ordering', () => {
  it('shows the newest note when a whole burst shares one second', () => {
    // Ids deliberately descending: sorting by them puts "First" last, which is
    // what made the line show an arbitrary thought and appear to go backwards.
    render(
      <ThinkingPanel
        runStatus="running"
        events={[
          thought('ffff', 'First thought', 1_700_000_000),
          thought('aaaa', 'Second thought', 1_700_000_000),
          thought('5555', 'Third thought', 1_700_000_000),
        ]}
      />,
    )

    expect(screen.getByText('Third thought')).toBeTruthy()
  })

  it('still respects the clock when the notes span seconds', () => {
    render(
      <ThinkingPanel
        runStatus="running"
        events={[
          thought('a', 'Later thought', 1_700_000_009),
          thought('b', 'Earlier thought', 1_700_000_001),
        ]}
      />,
    )

    expect(screen.getByText('Later thought')).toBeTruthy()
  })
})
