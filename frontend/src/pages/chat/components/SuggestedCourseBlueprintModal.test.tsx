import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { normalizeCourseBlueprintRecommendation } from '../../../services/courseBlueprintService'
import { buildSuggestedBlueprintSavePayload, RecommendationView } from './SuggestedCourseBlueprintModal'

const rawRecommendation = {
  title: 'Eight-week plan',
  summary: 'A reusable roadmap',
  planning_horizon_weeks: 8,
  plan_scope: 'full_course',
  weekly_plan: [
    { week: 1, theme: 'Foundations', source_status: 'generated_artifact', source_refs: ['lesson-1'] },
    { week: 2, theme: 'Interfaces', source_status: 'proposed' },
  ],
  assessment_strategy: '',
  lab_strategy: '',
  teaching_preferences: {},
  open_questions: [],
  assumptions: ['Students know basic programming'],
  source_summary: 'Week 1 came from a saved lesson.',
} as const

describe('structured Course Blueprint recommendation', () => {
  it('normalizes a substantive recommendation and rejects title-only content', () => {
    const recommendation = normalizeCourseBlueprintRecommendation(rawRecommendation)
    expect(recommendation?.weekly_plan).toHaveLength(2)
    expect(normalizeCourseBlueprintRecommendation({ title: 'Only title', plan_scope: 'full_course' })).toBeNull()
  })

  it('renders plan provenance, assumptions, and source summary', () => {
    const recommendation = normalizeCourseBlueprintRecommendation(rawRecommendation)!
    const html = renderToStaticMarkup(<RecommendationView recommendation={recommendation} />)
    expect(html).toContain('From generated artifact')
    expect(html).toContain('Proposed')
    expect(html).toContain('Students know basic programming')
    expect(html).toContain('Week 1 came from a saved lesson.')
  })

  it('builds direct-save payload from the exact recommendation and source message', () => {
    const recommendation = normalizeCourseBlueprintRecommendation(rawRecommendation)!
    const payload = buildSuggestedBlueprintSavePayload({ message_id: 'm1', chat_id: 'c1', role: 'assistant', content: 'Plan', created_at: null, run_id: 'r1' }, recommendation)
    expect(payload.weekly_plan).toEqual(recommendation.weekly_plan)
    expect(payload.source_message_id).toBe('m1')
    expect(payload.source_run_id).toBe('r1')
  })
})
