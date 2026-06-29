import { describe, expect, it } from 'vitest'
import {
  hasSubstantiveBlueprintContent,
  normalizeApiErrorMessage,
} from './CourseBlueprintReviewModal'
import type { CourseBlueprintContent } from '../../../services/courseBlueprintService'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function emptyForm(overrides: Partial<CourseBlueprintContent> = {}): CourseBlueprintContent {
  return {
    title: 'Course Blueprint for Test Course',
    summary: '',
    weekly_plan: [],
    assessment_strategy: '',
    lab_strategy: '',
    teaching_preferences: {},
    open_questions: [],
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// hasSubstantiveBlueprintContent
// ---------------------------------------------------------------------------

describe('hasSubstantiveBlueprintContent', () => {
  it('returns false when only title is set', () => {
    expect(hasSubstantiveBlueprintContent(emptyForm(), [])).toBe(false)
  })

  it('returns true when summary has content', () => {
    expect(hasSubstantiveBlueprintContent(emptyForm({ summary: 'A course about React.' }), [])).toBe(true)
  })

  it('returns true when assessment_strategy has content', () => {
    expect(hasSubstantiveBlueprintContent(emptyForm({ assessment_strategy: 'Weekly quizzes.' }), [])).toBe(true)
  })

  it('returns true when lab_strategy has content', () => {
    expect(hasSubstantiveBlueprintContent(emptyForm({ lab_strategy: 'Pair programming.' }), [])).toBe(true)
  })

  it('returns true when a weekly plan item has a theme', () => {
    const form = emptyForm({ weekly_plan: [{ week: 1, theme: 'Intro to React' }] })
    expect(hasSubstantiveBlueprintContent(form, [])).toBe(true)
  })

  it('returns false when a weekly plan item has no text fields', () => {
    const form = emptyForm({ weekly_plan: [{ week: 1, theme: '' }] })
    expect(hasSubstantiveBlueprintContent(form, [])).toBe(false)
  })

  it('returns true when there is a substantive teaching preference', () => {
    expect(hasSubstantiveBlueprintContent(emptyForm(), [{ key: 'pace', value: 'slow' }])).toBe(true)
  })

  it('returns false when preference key or value is empty', () => {
    expect(hasSubstantiveBlueprintContent(emptyForm(), [{ key: '', value: 'slow' }])).toBe(false)
    expect(hasSubstantiveBlueprintContent(emptyForm(), [{ key: 'pace', value: '' }])).toBe(false)
  })

  it('returns true when there is a non-empty open question', () => {
    expect(hasSubstantiveBlueprintContent(emptyForm({ open_questions: ['How long is the course?'] }), [])).toBe(true)
  })

  it('returns false when open_questions contains only empty strings', () => {
    expect(hasSubstantiveBlueprintContent(emptyForm({ open_questions: ['', '  '] }), [])).toBe(false)
  })

  it('returns true after "Copy source into Summary" action (non-empty content)', () => {
    const form = emptyForm({ summary: '## Week 1\nIntro to React\n**Key Concepts**: ...' })
    expect(hasSubstantiveBlueprintContent(form, [])).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// normalizeApiErrorMessage
// ---------------------------------------------------------------------------

describe('normalizeApiErrorMessage', () => {
  it('returns a fallback string for null/undefined', () => {
    expect(normalizeApiErrorMessage(null)).toBe('An unexpected error occurred.')
    expect(normalizeApiErrorMessage(undefined)).toBe('An unexpected error occurred.')
  })

  it('extracts string detail from FastAPI response', () => {
    const err = { response: { data: { detail: 'at least one substantive planning field is required' } } }
    expect(normalizeApiErrorMessage(err)).toBe('at least one substantive planning field is required')
  })

  it('handles FastAPI 422 detail as array of validation objects', () => {
    const err = {
      response: {
        data: {
          detail: [
            { loc: ['body', 'summary'], msg: 'field required', type: 'missing' },
            { loc: ['body', 'title'], msg: 'value too short', type: 'string_too_short' },
          ],
        },
      },
    }
    const result = normalizeApiErrorMessage(err)
    expect(typeof result).toBe('string')
    expect(result).toContain('field required')
    expect(result).toContain('value too short')
    // Must not be an object — check it's a plain string
    expect(result).not.toContain('[object Object]')
  })

  it('handles FastAPI 422 detail as array of strings', () => {
    const err = { response: { data: { detail: ['Bad request', 'Missing field'] } } }
    const result = normalizeApiErrorMessage(err)
    expect(result).toBe('Bad request; Missing field')
  })

  it('returns empty array fallback message', () => {
    const err = { response: { data: { detail: [] } } }
    const result = normalizeApiErrorMessage(err)
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
  })

  it('falls back to message property when no detail', () => {
    const err = { message: 'Network Error' }
    expect(normalizeApiErrorMessage(err)).toBe('Network Error')
  })

  it('returns a default message when no useful field is present', () => {
    expect(normalizeApiErrorMessage({})).toBe('Could not save the Course Blueprint.')
  })

  it('never returns an object or array (always a string)', () => {
    const cases = [
      { response: { data: { detail: { something: 'weird' } } } },
      { response: { data: { detail: [{ loc: [], msg: 'err', type: 't' }] } } },
      { message: 'plain error' },
      {},
      null,
    ]
    for (const err of cases) {
      const result = normalizeApiErrorMessage(err)
      expect(typeof result).toBe('string')
    }
  })
})
