import { useEffect, useState } from 'react'

import { getCurrentCourseBlueprint } from '../services/courseBlueprintService'
import type { CourseBlueprint } from '../services/courseBlueprintService'
import type { Artifact } from '../services/artifactService'

export type WorkflowPrefill = {
  /** The week this workflow has not covered yet. */
  week: number
  /** Empty without a course plan — there is nothing to derive it from. */
  topic: string
  /** Empty without a course plan, for the same reason. */
  priorKnowledge: string
  /** What the values came from, so the form can say so rather than filling
   *  a required field by magic. */
  source: 'course-plan' | 'week-only'
}

/** The week after the furthest one already generated. */
function nextWeek(artifacts: Artifact[]): number {
  const weeks = artifacts.map((item) => Number(item.week)).filter((week) => Number.isFinite(week) && week >= 1)
  return weeks.length > 0 ? Math.max(...weeks) + 1 : 1
}

/**
 * What a standalone generation form should already be holding when it opens.
 *
 * A lecturer arriving at the Lesson Plans page has almost always just finished
 * week N and wants week N+1 — so the form asking for a week number, a topic and
 * what students already know is asking for three things it can work out. Two of
 * the three it can only work out from a Course Plan.
 *
 * The split matters:
 *  - with a plan, the week's theme is the topic and the *previous* week's theme
 *    is what students already know, which is exactly what "prior knowledge"
 *    means and exactly what the plan records;
 *  - without one, only the week is knowable. Guessing a topic from nothing
 *    would put words in the lecturer's mouth on a field the agent then treats
 *    as instruction.
 *
 * Nothing here overwrites: callers apply it once per batch, and only to fields
 * the lecturer has not filled themselves.
 */
export function useWorkflowPrefill(
  batchId: string | null,
  /**
   * `null` means "not fetched yet", which is not the same as "none" — and the
   * difference is the whole bug this parameter exists to prevent. The blueprint
   * lookup and the artifact list race; the blueprint usually wins, and an empty
   * array read as "no artifacts" offered week 1 for a space already on week 4.
   * The form took that, marked itself filled, and ignored the real answer when
   * it landed a moment later.
   */
  artifacts: Artifact[] | null,
): WorkflowPrefill | null {
  const [blueprint, setBlueprint] = useState<CourseBlueprint | null>(null)
  const [checked, setChecked] = useState(false)

  useEffect(() => {
    setBlueprint(null)
    setChecked(false)
    if (!batchId) return undefined
    let cancelled = false
    getCurrentCourseBlueprint(batchId)
      .then((value) => {
        if (!cancelled) setBlueprint(value)
      })
      .catch(() => {
        // No plan, or it could not be read. Either way the week still helps.
      })
      .finally(() => {
        if (!cancelled) setChecked(true)
      })
    return () => {
      cancelled = true
    }
  }, [batchId])

  // Held until both lookups have settled, so the form is filled once and with
  // the right answer.
  if (!batchId || !checked || artifacts === null) return null

  const week = nextWeek(artifacts)
  const plan = blueprint?.weekly_plan ?? []
  const thisWeek = plan.find((item) => Number(item.week) === week)
  const previous = plan.find((item) => Number(item.week) === week - 1)

  if (!thisWeek) return { week, topic: '', priorKnowledge: '', source: 'week-only' }

  return {
    week,
    topic: thisWeek.theme || '',
    priorKnowledge: [previous?.theme, previous?.lesson_goal].filter(Boolean).join(' — '),
    source: 'course-plan',
  }
}
