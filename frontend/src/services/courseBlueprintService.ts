import api from '../lib/api'

export type CourseBlueprintWeeklyPlanItem = {
  week: number
  theme: string
  lesson_goal?: string | null
  lab_goal?: string | null
  assessment_idea?: string | null
  notes?: string | null
  source_status?: 'generated_artifact' | 'saved_blueprint' | 'user_provided' | 'proposed' | 'unknown' | null
  source_refs?: string[]
}

export type CourseBlueprintContent = {
  title: string
  summary: string
  weekly_plan: CourseBlueprintWeeklyPlanItem[]
  assessment_strategy: string
  lab_strategy: string
  teaching_preferences: Record<string, string>
  open_questions: string[]
  planning_horizon_weeks?: number | null
  plan_scope?: 'full_course' | 'remaining_weeks' | 'strategy_only' | 'partial_update' | null
  assumptions?: string[]
  source_summary?: string
}

export type CourseBlueprintRecommendation = CourseBlueprintContent & {
  plan_scope: NonNullable<CourseBlueprintContent['plan_scope']>
}

export function normalizeCourseBlueprintRecommendation(value: unknown): CourseBlueprintRecommendation | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const title = typeof raw.title === 'string' ? raw.title.trim().slice(0, 300) : ''
  const scopes = new Set(['full_course', 'remaining_weeks', 'strategy_only', 'partial_update'])
  const plan_scope = typeof raw.plan_scope === 'string' && scopes.has(raw.plan_scope)
    ? raw.plan_scope as CourseBlueprintRecommendation['plan_scope']
    : null
  if (!title || !plan_scope) return null
  const statuses = new Set(['generated_artifact', 'saved_blueprint', 'user_provided', 'proposed', 'unknown'])
  const weeks = new Set<number>()
  const weekly_plan: CourseBlueprintWeeklyPlanItem[] = []
  if (Array.isArray(raw.weekly_plan)) {
    for (const item of raw.weekly_plan.slice(0, 104)) {
      if (!item || typeof item !== 'object') return null
      const row = item as Record<string, unknown>
      const week = Number(row.week)
      const theme = typeof row.theme === 'string' ? row.theme.trim().slice(0, 300) : ''
      if (!Number.isInteger(week) || week < 1 || week > 104 || weeks.has(week) || !theme) return null
      weeks.add(week)
      const sourceStatus = typeof row.source_status === 'string' && statuses.has(row.source_status)
        ? row.source_status as CourseBlueprintWeeklyPlanItem['source_status']
        : null
      weekly_plan.push({
        week,
        theme,
        lesson_goal: optionalText(row.lesson_goal, 2000),
        lab_goal: optionalText(row.lab_goal, 2000),
        assessment_idea: optionalText(row.assessment_idea, 2000),
        notes: optionalText(row.notes, 2000),
        source_status: sourceStatus,
        source_refs: Array.isArray(row.source_refs)
          ? row.source_refs.filter((ref): ref is string => typeof ref === 'string').map((ref) => ref.trim().slice(0, 300)).filter(Boolean).slice(0, 10)
          : [],
      })
    }
  }
  weekly_plan.sort((a, b) => a.week - b.week)
  const teaching_preferences: Record<string, string> = {}
  if (raw.teaching_preferences && typeof raw.teaching_preferences === 'object' && !Array.isArray(raw.teaching_preferences)) {
    for (const [key, item] of Object.entries(raw.teaching_preferences).slice(0, 50)) {
      if (typeof item === 'string' && key.trim() && item.trim()) teaching_preferences[key.trim().slice(0, 200)] = item.trim().slice(0, 2000)
    }
  }
  const recommendation: CourseBlueprintRecommendation = {
    title,
    summary: requiredText(raw.summary, 8000),
    weekly_plan,
    assessment_strategy: requiredText(raw.assessment_strategy, 8000),
    lab_strategy: requiredText(raw.lab_strategy, 8000),
    teaching_preferences,
    open_questions: stringList(raw.open_questions, 100, 2000),
    planning_horizon_weeks: validHorizon(raw.planning_horizon_weeks),
    plan_scope,
    assumptions: stringList(raw.assumptions, 100, 2000),
    source_summary: requiredText(raw.source_summary, 4000),
  }
  const substantive = Boolean(
    recommendation.summary || recommendation.weekly_plan.length || recommendation.assessment_strategy ||
    recommendation.lab_strategy || Object.keys(recommendation.teaching_preferences).length || recommendation.open_questions.length
  )
  return substantive && new TextEncoder().encode(JSON.stringify(recommendation)).length <= 200_000
    ? recommendation
    : null
}

function requiredText(value: unknown, limit: number): string {
  return typeof value === 'string' ? value.trim().slice(0, limit) : ''
}

function optionalText(value: unknown, limit: number): string | null {
  const text = requiredText(value, limit)
  return text || null
}

function stringList(value: unknown, maximum: number, itemLimit: number): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string').map((item) => item.trim().slice(0, itemLimit)).filter(Boolean).slice(0, maximum)
    : []
}

function validHorizon(value: unknown): number | null {
  const horizon = Number(value)
  return Number.isInteger(horizon) && horizon >= 1 && horizon <= 104 ? horizon : null
}

export type CourseBlueprint = CourseBlueprintContent & {
  blueprint_id: string
  batch_id: string
  lecturer_id: string
  course_name: string
  status: 'active' | 'superseded' | 'archived'
  version: number
  is_current: boolean
  supersedes_blueprint_id?: string
  superseded_by_blueprint_id?: string
  source_chat_id?: string
  source_message_id?: string
  source_run_id?: string
  content_hash: string
  created_at?: string | null
  updated_at?: string | null
  idempotent?: boolean
}

export type SaveCourseBlueprintFromMessage = CourseBlueprintContent & {
  source_chat_id: string
  source_message_id: string
  source_run_id?: string
}

export async function getCurrentCourseBlueprint(batchId: string): Promise<CourseBlueprint | null> {
  const res = await api.get<{ blueprint: CourseBlueprint | null }>(
    `/batches/${batchId}/course-blueprint/current`,
  )
  return res.data.blueprint
}

export async function listCourseBlueprintHistory(batchId: string): Promise<CourseBlueprint[]> {
  const res = await api.get<CourseBlueprint[]>(`/batches/${batchId}/course-blueprint/history`)
  return res.data
}

export async function saveCourseBlueprintFromMessage(
  batchId: string,
  payload: SaveCourseBlueprintFromMessage,
): Promise<CourseBlueprint> {
  const res = await api.post<CourseBlueprint>(
    `/batches/${batchId}/course-blueprint/from-message`,
    payload,
  )
  return res.data
}

export async function updateCurrentCourseBlueprint(
  batchId: string,
  payload: CourseBlueprintContent,
): Promise<CourseBlueprint> {
  const res = await api.put<CourseBlueprint>(`/batches/${batchId}/course-blueprint/current`, payload)
  return res.data
}

export async function saveBlueprintFromRun(
  batchId: string,
  chatId: string,
  runId: string,
): Promise<{ blueprint_id: string; version?: number; artifact_type: string }> {
  const res = await api.post<{ blueprint_id: string; version?: number; artifact_type: string }>(
    `/batches/${batchId}/chats/${chatId}/runs/${runId}/pending-artifact/save-blueprint`,
  )
  return res.data
}

export async function archiveCurrentCourseBlueprint(batchId: string): Promise<CourseBlueprint> {
  const res = await api.post<CourseBlueprint>(
    `/batches/${batchId}/course-blueprint/current/archive`,
  )
  return res.data
}

/**
 * Undo an archive: the same version becomes current again.
 *
 * Deliberately not `revertToCourseBlueprintVersion` — that one clones the content
 * into a new version, which after an archive leaves the lecturer with an identical
 * pair (vN archived, vN+1 active) and no way to tell them apart.
 */
export async function restoreCourseBlueprintVersion(
  batchId: string,
  blueprintId: string,
): Promise<CourseBlueprint> {
  const res = await api.post<CourseBlueprint>(
    `/batches/${batchId}/course-blueprint/versions/${blueprintId}/restore`,
  )
  return res.data
}

export async function revertToCourseBlueprintVersion(
  batchId: string,
  blueprintId: string,
): Promise<CourseBlueprint> {
  const res = await api.post<CourseBlueprint>(
    `/batches/${batchId}/course-blueprint/versions/${blueprintId}/revert`,
  )
  return res.data
}

export async function deleteCourseBlueprintVersion(
  batchId: string,
  blueprintId: string,
): Promise<void> {
  await api.delete(`/batches/${batchId}/course-blueprint/versions/${blueprintId}`)
}
