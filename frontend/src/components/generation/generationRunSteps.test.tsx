// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AgentRunEvent } from '../../services/agentRunStream'
import type { Batch } from '../../entity/Batch'
import type { GenerationRunState } from '../../hooks/useGenerationRun'
import { GenerationRunView } from './GenerationRunView'
import { isWorkflowSettled } from './generationStage'

vi.mock('react-markdown', () => ({
  default: (props: { children?: unknown }) => <div>{String(props.children ?? '')}</div>,
}))
vi.mock('../../services/authService', () => ({ startGoogleOAuth: vi.fn() }))

class FakeResizeObserver {
  observe() {}
  disconnect() {}
}

beforeEach(() => {
  ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = FakeResizeObserver
})
afterEach(() => {
  cleanup()
  delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver
})

let seq = 0
function event(overrides: Partial<AgentRunEvent>): AgentRunEvent {
  seq += 1
  return {
    event_id: `e${seq}`,
    kind: 'tool',
    status: 'running',
    title: '',
    created_at: seq,
    ...overrides,
  } as AgentRunEvent
}

const batch = { id: 'b1', batch_name: 'Software Testing 26' } as Batch

/** A run mid-generation: a pending assistant message plus live events. */
function generatingRun(events: AgentRunEvent[]): GenerationRunState {
  const runId = 'run-1'
  return {
    messages: [
      {
        message_id: 'pending-run-1', chat_id: 'c1', role: 'assistant', content: '',
        created_at: null, status: 'pending', run_id: runId, pending: true,
      },
    ],
    runStates: { [runId]: { status: 'running', events, steps: {} } },
    currentRunId: runId,
    activePhase: 'outline',
    sending: true,
    cancelling: false,
    cancelRun: () => Promise.resolve(),
  } as unknown as GenerationRunState
}

const view = (events: AgentRunEvent[]) =>
  render(<GenerationRunView batch={batch} run={generatingRun(events)} />)

describe('the standalone generation card while working', () => {
  it('shows the working note and the steps together', () => {
    const { container } = view([
      event({ kind: 'thinking', summary: 'Weighing two framings' }),
      event({ tool_call_id: 'a', title: 'Checking saved materials', status: 'started' }),
    ])

    expect(screen.getByText('Weighing two framings')).toBeTruthy()
    expect(screen.getByText('Checking saved materials')).toBeTruthy()
    expect(container).toBeTruthy()
  })

  it('puts the steps under the note, as chat does', () => {
    view([
      event({ kind: 'thinking', summary: 'Weighing two framings' }),
      event({ tool_call_id: 'a', title: 'Checking saved materials', status: 'started' }),
    ])

    const note = screen.getByText('Weighing two framings')
    const step = screen.getByText('Checking saved materials')

    expect(note.compareDocumentPosition(step) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('caps the step list rather than letting a fan-out grow the card', () => {
    // Chat can afford to grow — the transcript is the scroll container. Here the
    // run sits in a fixed card on a form page, and an unbounded list would push
    // the Stop button and the "keep working elsewhere" notice off the bottom.
    const { container } = view([
      event({ tool_call_id: 'a', title: 'Reading the course plan', status: 'started' }),
      event({ tool_call_id: 'b', title: 'Checking saved materials', status: 'started' }),
      event({ tool_call_id: 'c', title: 'Reading a saved quiz', status: 'started' }),
      event({ tool_call_id: 'd', title: 'Searching the web', status: 'started' }),
      event({ tool_call_id: 'e', title: 'Reading lecture notes', status: 'started' }),
      event({ tool_call_id: 'f', title: 'Checking the blueprint', status: 'started' }),
    ])

    // Sized by what is left in the card, not by a fixed height that knows
    // nothing about the notice below it — which is how a long list ended up
    // clipped against copy rather than reading as scrollable.
    const capped = container.querySelector('.flex-1.overflow-y-auto')
    expect(capped).toBeTruthy()
    expect(capped?.className).toContain('min-h-0')
    // Every row is still rendered — it scrolls, it does not truncate.
    expect(capped?.querySelectorAll('.mila-step-row')).toHaveLength(6)
  })

  it('keeps Stop out of the scrolling region entirely', () => {
    // It used to sit below the step list, so every arriving step pushed the one
    // control available during a run further down the card.
    view([
      event({ tool_call_id: 'a', title: 'Reading the course plan', status: 'started' }),
      event({ tool_call_id: 'b', title: 'Checking saved materials', status: 'started' }),
      event({ tool_call_id: 'c', title: 'Reading a saved quiz', status: 'started' }),
      event({ tool_call_id: 'd', title: 'Searching the web', status: 'started' }),
      event({ tool_call_id: 'e', title: 'Reading lecture notes', status: 'started' }),
      event({ tool_call_id: 'f', title: 'Checking the blueprint', status: 'started' }),
    ])

    const stop = screen.getByText('Stop generating')
    const capped = document.querySelector('.flex-1.overflow-y-auto')

    expect(capped?.contains(stop)).toBe(false)
    // And it is a real button, not the small ghost link it replaced.
    expect(stop.closest('button')?.className).toContain('maia-btn')
  })

  it('lets the background hint be dismissed for good', () => {
    view([event({ tool_call_id: 'a', title: 'Checking saved materials', status: 'started' })])

    expect(screen.getByText(/Generation keeps running/)).toBeTruthy()
    fireEvent.click(screen.getByLabelText(/Don't show this again/))

    expect(screen.queryByText(/Generation keeps running/)).toBeNull()
  })

  it('offers Refine and View steps at full button size', () => {
    // They are the entire set of things a lecturer can do with a finished
    // result, and they were the smallest controls on the card.
    render(
      <GenerationRunView
        batch={batch}
        run={{
          ...generatingRun([]),
          sending: false,
          messages: [{
            message_id: 'm1', chat_id: 'c1', role: 'assistant',
            content: 'Draft outline', created_at: null, status: 'done', run_id: 'run-1',
            metadata: { artifact_type: 'lesson_plan', artifact_preview_card: true },
          }],
          runStates: { 'run-1': { status: 'done', events: [], steps: {} } },
        } as unknown as GenerationRunState}
      />,
    )

    for (const label of [/View steps/, /Refine this draft/]) {
      expect(screen.getByText(label).closest('button')?.className).toContain('maia-btn')
    }
  })

  it('stays dismissed on the next run', () => {
    // The point of persisting it: true once, furniture every time after.
    view([event({ tool_call_id: 'a', title: 'Checking saved materials', status: 'started' })])

    expect(screen.queryByText(/Generation keeps running/)).toBeNull()
  })
})

describe('when starting over is offered', () => {
  it('waits until the workflow has actually finished', () => {
    // It used to appear the moment a run started, so a tap mid-generation — or
    // mid-approval — discarded work in progress with no warning and no undo.
    expect(isWorkflowSettled('generating_outline')).toBe(false)
    expect(isWorkflowSettled('generating_full')).toBe(false)
  })

  it('does not offer it while the run is paused on the lecturer', () => {
    // `outline_review` asks them to approve or refine. "Generate another"
    // beside that invites throwing the outline away by reflex.
    expect(isWorkflowSettled('outline_review')).toBe(false)
  })

  it('offers it once there is a result, or none is coming', () => {
    expect(isWorkflowSettled('preview')).toBe(true)
    expect(isWorkflowSettled('done')).toBe(true)
    expect(isWorkflowSettled('failed')).toBe(true)
    expect(isWorkflowSettled('cancelled')).toBe(true)
  })
})

/**
 * The export controls are the point of the whole workflow — the Google Doc or
 * Form the run just wrote. A finished run that does not show them has lost the
 * thing it was for.
 */
describe('the finished result', () => {
  function settled(metadata: Record<string, unknown>) {
    return {
      ...generatingRun([]),
      sending: false,
      messages: [{
        message_id: 'm1', chat_id: 'c1', role: 'assistant', content: 'Draft',
        created_at: null, status: 'done', run_id: 'run-1', metadata,
      }],
      runStates: { 'run-1': { status: 'done', events: [], steps: {} } },
    } as unknown as GenerationRunState
  }

  it('links the Google Doc even with no artifact record to fetch', () => {
    // The guard used to require `draft_artifact_id`, so a message carrying only
    // `doc_url` rendered nothing — the run reached Done and the document it had
    // just written was nowhere on the page.
    render(
      <GenerationRunView
        batch={batch}
        run={settled({
          artifact_type: 'lesson_plan',
          artifact_preview_card: true,
          doc_url: 'https://docs.google.com/document/d/abc',
        })}
      />,
    )

    expect(screen.getByText('Open Google Doc')).toBeTruthy()
  })

  it('links the Form for an assessment', () => {
    render(
      <GenerationRunView
        batch={batch}
        run={settled({
          artifact_type: 'quiz',
          artifact_preview_card: true,
          form_url: 'https://docs.google.com/forms/d/abc',
        })}
      />,
    )

    expect(screen.getByText('Open Google Form')).toBeTruthy()
  })
})

/**
 * The steps panel. It slides in from the right the way the composer's
 * "Previous attachments" panel does, and the steps drop down once it has
 * arrived — two beats, not one lurch.
 */
describe('viewing the steps of a finished run', () => {
  function finished() {
    return {
      ...generatingRun([]),
      sending: false,
      messages: [{
        message_id: 'm1', chat_id: 'c1', role: 'assistant', content: 'Draft',
        created_at: null, status: 'done', run_id: 'run-1',
        metadata: { artifact_type: 'lesson_plan', artifact_preview_card: true },
      }],
      runStates: {
        'run-1': {
          status: 'done',
          steps: {},
          events: [event({ tool_call_id: 'a', title: 'Checking saved materials', status: 'success' })],
        },
      },
    } as unknown as GenerationRunState
  }

  const panel = () => document.body.querySelector<HTMLElement>('[role="dialog"]')
  const collapse = () =>
    document.body.querySelector<HTMLElement>('.transition-\\[grid-template-rows\\]')

  it('is not mounted until asked for', () => {
    render(<GenerationRunView batch={batch} run={finished()} />)

    expect(panel()).toBeNull()
  })

  it('starts off-screen so it has somewhere to slide from', () => {
    // It used to be painted straight into its final position — nothing to
    // transition out of, so it simply appeared.
    render(<GenerationRunView batch={batch} run={finished()} />)
    fireEvent.click(screen.getByText('View steps'))

    expect(panel()?.className).toContain('translate-x-full')
    expect(panel()?.className).toContain('transition-transform')
  })

  it('holds the steps closed until the panel has arrived', () => {
    render(<GenerationRunView batch={batch} run={finished()} />)
    fireEvent.click(screen.getByText('View steps'))

    expect(collapse()?.style.gridTemplateRows).toBe('0fr')
  })

  it('shows the steps without asking for a second tap', () => {
    // The panel used to open onto a collapsed "Completed N steps" toggle.
    render(<GenerationRunView batch={batch} run={finished()} />)
    fireEvent.click(screen.getByText('View steps'))

    expect(screen.getByText('Checking saved materials')).toBeTruthy()
  })

  it('does not promise thinking it cannot show', () => {
    // ThinkingPanel returns null for a settled run by design.
    render(<GenerationRunView batch={batch} run={finished()} />)

    expect(screen.queryByText(/thinking/i)).toBeNull()
  })
})

describe('the panel leaving', () => {
  function finishedRun() {
    return {
      ...generatingRun([]),
      sending: false,
      messages: [{
        message_id: 'm1', chat_id: 'c1', role: 'assistant', content: 'Draft',
        created_at: null, status: 'done', run_id: 'run-1',
        metadata: { artifact_type: 'lesson_plan', artifact_preview_card: true },
      }],
      runStates: { 'run-1': { status: 'done', steps: {}, events: [] } },
    } as unknown as GenerationRunState
  }

  it('accelerates away rather than easing out again', () => {
    // index.css: "200ms for something leaving on cubic-bezier(0.4, 0, 1, 1)".
    // A thing that is leaving should not ask for as much attention as a thing
    // that just arrived, and easing *out* holds it longest at the moment it is
    // least interesting.
    render(<GenerationRunView batch={batch} run={finishedRun()} />)
    fireEvent.click(screen.getByText('View steps'))

    const panel = document.body.querySelector<HTMLElement>('[role="dialog"]')
    expect(panel?.className).toContain('duration-200')
    expect(panel?.className).toContain('ease-in')
  })
})
