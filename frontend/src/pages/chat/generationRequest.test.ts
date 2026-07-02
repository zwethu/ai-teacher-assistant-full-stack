import { describe, expect, it } from 'vitest'

import { buildGenerationRequest, type AttachmentAwareGenerateMode } from './generationRequest'

describe.each([
  ['lesson_plan', 'Please use the earlier attachment outline.pdf. Attachment ID: doc-1'],
  ['lab', 'Use the earlier screenshot as the expected result. Attachment ID: image-1'],
  ['assessment', 'Build the quiz from the earlier PDF. Attachment ID: doc-2'],
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
