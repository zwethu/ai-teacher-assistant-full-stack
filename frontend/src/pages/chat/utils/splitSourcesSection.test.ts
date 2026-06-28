import { describe, expect, it } from 'vitest'

import { splitSourcesSection } from './splitSourcesSection'

describe('splitSourcesSection', () => {
  it('keeps all content in the body when there is no sources heading', () => {
    expect(splitSourcesSection('Main answer\n\nSources & Tool Status appears in normal prose.')).toEqual({
      body: 'Main answer\n\nSources & Tool Status appears in normal prose.',
      sources: '',
    })
  })

  it('preserves sources as the final section', () => {
    expect(splitSourcesSection('Main answer\n\n## Sources & Tool Status\n- Course Materials: Success')).toEqual({
      body: 'Main answer',
      sources: '## Sources & Tool Status\n- Course Materials: Success',
    })
  })

  it('returns a later heading section to the body', () => {
    const result = splitSourcesSection(
      'Main answer\n\n## Sources & Tool Status\n- Course Materials: Success\n\n### What would you like to do next?\n- Plan Week 4',
    )
    expect(result.body).toBe('Main answer\n\n### What would you like to do next?\n- Plan Week 4')
    expect(result.sources).toBe('## Sources & Tool Status\n- Course Materials: Success')
  })

  it('moves a horizontal rule before the next heading back into the body', () => {
    const result = splitSourcesSection(
      'Main answer\n\n## Sources & Tool Status\n- Course Materials: Success\n\n---\n\n### What would you like to do next?\n- Plan Week 4',
    )
    expect(result.body).toBe('Main answer\n\n---\n\n### What would you like to do next?\n- Plan Week 4')
    expect(result.sources).toBe('## Sources & Tool Status\n- Course Materials: Success')
  })

  it.each([
    '## Sources & Tool Status',
    'Sources & Tool Status:',
    '**Sources & Tool Status**',
    '- **Sources & Tool Status:**',
    '🔎 Sources & Tool Status',
    '- **🔎 Sources & Tool Status**',
  ])('detects heading variant %s', (heading) => {
    expect(splitSourcesSection(`Answer\n\n${heading}\n- Web: skipped`).sources).toContain(heading)
  })

  it('does not split when the phrase occurs inside normal prose', () => {
    const markdown = 'The Sources & Tool Status section explains which tools ran.'
    expect(splitSourcesSection(markdown)).toEqual({ body: markdown, sources: '' })
  })
})
