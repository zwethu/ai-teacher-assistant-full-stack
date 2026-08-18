/* Stress meter + activity journal — all state lives on the backend.
   The browser only reads state, reports rapid clicking, and triggers the
   breathing exercise. Feature costs (lesson plan, batch, email, chat) are
   charged server-side by the feature endpoints themselves.

   Nothing here can block a feature any more: the meter reports what the work
   is costing, and a lecturer with a deadline tomorrow keeps working. */

import api from '../lib/api'

export const MAX_STRESS = 100
export const BREATHING_REDUCTION = 20
export const RAPID_CLICK_STRESS = 5

/** Band floors, mirroring `wellness_service.py`. The server sends the band it
    decided on; these exist for copy ("75+ is high"), never to re-derive it. */
export const BAND_MEDIUM = 40
export const BAND_HIGH = 75
export const BAND_MAX = 95

export type StressLevel = 'low' | 'medium' | 'high' | 'max'

export interface StressState {
  stress_score: number
  level: StressLevel
  breathing_used_today: boolean
}

export interface BreathingResult extends StressState {
  stress_reduced: boolean
  message: string
}

/** One day of work, rolled up server-side. `in_progress` marks today, which is
    computed live and not stored — the day is not over yet. */
export interface DailyReport {
  date: string
  actions: Record<string, number>
  total_actions: number
  stress_added: number
  peak_score: number
  end_score: number
  breathing_done: boolean
  grind_actions: number
  grind_from: string
  in_progress: boolean
}

export interface JournalPage {
  month: string
  entries: DailyReport[]
}

/** How each activity bucket is named in the journal. Mirrors ACTION_LABELS. */
export const ACTION_LABELS: Record<string, string> = {
  lesson_plan: 'lesson plans and labs',
  artifact: 'assessments, games and blueprints',
  batch_create: 'batches created',
  email: 'emails drafted or sent',
  chat: 'chat messages',
  rapid_click: 'bursts of rapid clicking',
}

export async function getStress(): Promise<StressState> {
  const { data } = await api.get<StressState>('/wellness/stress')
  return data
}

export async function increaseStress(amount: number): Promise<StressState> {
  const { data } = await api.post<StressState>('/wellness/stress/increase', {
    amount,
  })
  return data
}

export async function completeBreathing(): Promise<BreathingResult> {
  const { data } = await api.post<BreathingResult>('/wellness/breathing')
  return data
}

/** One month of daily reports, newest first. `month` is YYYY-MM. */
export async function getJournal(month?: string): Promise<JournalPage> {
  const { data } = await api.get<JournalPage>('/wellness/journal', {
    params: month ? { month } : undefined,
  })
  return data
}
