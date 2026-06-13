import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from 'firebase/firestore'
import { db } from '../lib/firebase'

export const MAX_STRESS = 100
export const WARNING_THRESHOLD = 80
export const BREATHING_REDUCTION = 20
export const PASSIVE_DECAY_PER_HOUR = 5

export function localToday(): string {
  const now = new Date(Date.now() + 7 * 60 * 60 * 1000)
  return now.toISOString().slice(0, 10)
}

function todayStartUtcPlus7(): Date {
  return new Date(`${localToday()}T00:00:00+07:00`)
}

export function applyPassiveDecay(
  score: number,
  lastActiveAt: Timestamp | null | undefined,
): number {
  if (!lastActiveAt || typeof lastActiveAt.toDate !== 'function') return score
  const hours =
    (Date.now() - lastActiveAt.toDate().getTime()) / (1000 * 60 * 60)
  return Math.max(0, score - hours * PASSIVE_DECAY_PER_HOUR)
}

async function hasJournaledToday(uid: string): Promise<boolean> {
  const todayStart = Timestamp.fromDate(todayStartUtcPlus7())
  const q = query(
    collection(db, 'wellness_journal'),
    where('uid', '==', uid),
    where('created_at', '>=', todayStart),
    limit(1),
  )
  const snap = await getDocs(q)
  return !snap.empty
}

export interface StressState {
  stress_score: number
  warning: boolean
  blocked: boolean
  breathing_used_today: boolean
  journaled_today: boolean
}

export async function getStress(uid: string): Promise<StressState> {
  const ref = doc(db, 'user_stress', uid)
  const snap = await getDoc(ref)
  const now = Timestamp.now()

  let stressScore = 0
  let lastActiveAt: Timestamp = now
  let lastBreathingDate = ''

  if (snap.exists()) {
    const data = snap.data()
    stressScore = typeof data.stress_score === 'number' ? data.stress_score : 0
    lastActiveAt = (data.last_active_at as Timestamp) ?? now
    lastBreathingDate = (data.last_breathing_date as string) ?? ''
  } else {
    await setDoc(ref, {
      stress_score: 0,
      last_active_at: now,
      last_breathing_date: '',
    })
  }

  const decayed = applyPassiveDecay(stressScore, lastActiveAt)
  if (Math.abs(decayed - stressScore) >= 0.1) {
    stressScore = decayed
    await updateDoc(ref, {
      stress_score: decayed,
      last_active_at: now,
    })
  } else {
    stressScore = decayed
  }

  const journaled_today = await hasJournaledToday(uid)
  const breathing_used_today = lastBreathingDate === localToday()

  return {
    stress_score: stressScore,
    warning: stressScore >= WARNING_THRESHOLD && stressScore < MAX_STRESS,
    blocked: stressScore >= MAX_STRESS,
    breathing_used_today,
    journaled_today,
  }
}

export async function increaseStress(
  uid: string,
  amount: number,
): Promise<StressState> {
  const state = await getStress(uid)
  const ref = doc(db, 'user_stress', uid)
  const newScore = Math.min(MAX_STRESS, state.stress_score + amount)
  await updateDoc(ref, {
    stress_score: newScore,
    last_active_at: serverTimestamp(),
  })
  return getStress(uid)
}

export interface BreathingResult extends StressState {
  stress_reduced: boolean
  prompt_reflection: boolean
}

export async function completeBreathing(uid: string): Promise<BreathingResult> {
  const state = await getStress(uid)
  const ref = doc(db, 'user_stress', uid)

  if (!state.breathing_used_today) {
    const newScore = Math.max(0, state.stress_score - BREATHING_REDUCTION)
    await updateDoc(ref, {
      stress_score: newScore,
      last_breathing_date: localToday(),
      last_active_at: serverTimestamp(),
    })
    const updated = await getStress(uid)
    return {
      ...updated,
      stress_reduced: true,
      prompt_reflection: true,
    }
  }

  return {
    ...state,
    stress_reduced: false,
    prompt_reflection: false,
  }
}

export interface JournalEntry {
  id: string
  uid: string
  mood: string
  notes: string
  entry_type: string
  stress_score: number
  stress_reduced: boolean
  created_at: Timestamp | null
}

export async function getJournal(uid: string): Promise<JournalEntry[]> {
  const q = query(
    collection(db, 'wellness_journal'),
    where('uid', '==', uid),
    orderBy('created_at', 'desc'),
    limit(20),
  )
  const snap = await getDocs(q)
  return snap.docs.map((d) => {
    const data = d.data()
    return {
      id: d.id,
      uid: (data.uid as string) ?? uid,
      mood: (data.mood as string) ?? '',
      notes: (data.notes as string) ?? '',
      entry_type: (data.entry_type as string) ?? '',
      stress_score: (data.stress_score as number) ?? 0,
      stress_reduced: Boolean(data.stress_reduced),
      created_at: (data.created_at as Timestamp) ?? null,
    }
  })
}

export async function saveJournal(
  uid: string,
  mood: string,
  notes: string,
  stressScore: number,
): Promise<{ ok: boolean }> {
  if (await hasJournaledToday(uid)) return { ok: false }

  await addDoc(collection(db, 'wellness_journal'), {
    uid,
    mood,
    notes,
    entry_type: 'after_breathing',
    stress_score: stressScore,
    stress_reduced: true,
    created_at: serverTimestamp(),
  })
  return { ok: true }
}
