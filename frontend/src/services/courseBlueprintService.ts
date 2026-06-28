import api from '../lib/api'

export type CourseBlueprintWeeklyPlanItem = {
  week: number
  theme: string
  lesson_goal?: string | null
  lab_goal?: string | null
  assessment_idea?: string | null
  notes?: string | null
}

export type CourseBlueprintContent = {
  title: string
  summary: string
  weekly_plan: CourseBlueprintWeeklyPlanItem[]
  assessment_strategy: string
  lab_strategy: string
  teaching_preferences: Record<string, string>
  open_questions: string[]
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

export async function archiveCurrentCourseBlueprint(batchId: string): Promise<CourseBlueprint> {
  const res = await api.post<CourseBlueprint>(
    `/batches/${batchId}/course-blueprint/current/archive`,
  )
  return res.data
}
