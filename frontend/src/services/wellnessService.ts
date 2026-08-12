/* Stress meter + wellness journal — all state lives on the backend now.
   The browser only reads state, reports rapid clicking, and triggers the
   breathing exercise / reflection. Feature costs (lesson plan, batch, email,
   chat) are charged server-side by the feature endpoints themselves. */

import api from '../lib/api'

export const MAX_STRESS = 100
export const WARNING_THRESHOLD = 80
export const FORCED_BREATHING_THRESHOLD = 85
export const BREATHING_REDUCTION = 20
export const RAPID_CLICK_STRESS = 5

export interface StressState {
  stress_score: number
  warning: boolean
  blocked: boolean
  breathing_used_today: boolean
  journaled_today: boolean
}

export interface BreathingResult extends StressState {
  stress_reduced: boolean
  prompt_reflection: boolean
  message: string
}

export interface JournalEntry {
  id: string
  uid: string
  mood: string
  notes: string
  entry_type: string
  stress_score: number
  stress_reduced: boolean
  created_at: string | null
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

export async function getJournal(): Promise<JournalEntry[]> {
  const { data } = await api.get<JournalEntry[]>('/wellness/journal')
  return data
}

export async function saveJournal(
  mood: string,
  notes: string,
): Promise<{ ok: boolean }> {
  const { data } = await api.post<{ ok: boolean }>('/wellness/journal', {
    mood,
    notes,
  })
  return data
}
