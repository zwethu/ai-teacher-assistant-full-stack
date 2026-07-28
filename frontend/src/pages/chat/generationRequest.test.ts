import { describe, expect, it } from 'vitest'

import { buildGenerationRequest, type AttachmentAwareGenerateMode } from './generationRequest'

describe.each([
  ['lesson_plan', 'Please use the earlier attachment outline.pdf. Attachment ID: doc-1'],
  ['lab', 'Use the earlier screenshot as the expected result. Attachment ID: image-1'],
  ['assessment', 'Build the quiz from the earlier PDF. Attachment ID: doc-2'],
  ['course_blueprint', 'Build the course plan from the earlier syllabus. Attachment ID: doc-3'],
] as Array<[AttachmentAwareGenerateMode, string]>)('%s attachment-aware generation', (mode, message) => {
  it('preserves reference text and current attachment IDs in the invoke request', () => {
    const request = buildGenerationRequest(
      mode,
      'batch-1',
      'chat-1',
      message,
      { web_search: true },
      ['current-attachment'],
    )

    expect(request.message).toBe(message)
    expect(request.workflow_type).toBe(`${mode}.generate`)
    expect(request.workflow_stage).toBe('outline')
    expect(request.attachment_ids).toEqual(['current-attachment'])
  })
})

describe('game generation', () => {
  const request = buildGenerationRequest(
    'game',
    'batch-1',
    'chat-1',
    'Build a matching game from these lecture notes. Attachment ID: doc-9',
    { web_search: true },
    ['doc-9'],
  )

  it('is single-shot: no outline stage', () => {
    // An 'outline' stage would send the run into the backend's outline branch, which has
    // no game outline to extract — the run would fail instead of staging a game.
    expect(request.workflow_stage).toBe('')
    expect(request.workflow_type).toBe('game.generate')
  })

  it('still uses the pending-artifact path so the Create game button appears', () => {
    expect(request.pending_artifact).toBe(true)
    expect(request.save_draft).toBe(false)
  })

  it('forces web search off — a game comes only from the attached PDF', () => {
    expect(request.connectors).toEqual({ web_search: false })
  })

  it('carries the attachment the game is built from', () => {
    expect(request.attachment_ids).toEqual(['doc-9'])
  })

  it('never requests a week', () => {
    expect(request.week).toBeUndefined()
  })
})
