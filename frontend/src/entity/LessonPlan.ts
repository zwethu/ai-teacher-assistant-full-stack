import type { DocumentSnapshot } from 'firebase/firestore'
import type { BaseDoc } from '../types'
import { baseFromFirestore, omitUndefined } from './_helpers'

export interface LessonPlan extends BaseDoc {
  subject: string
  grade: string
  topic: string
  duration: string
  objectives: string
  content: unknown
}

export const defaultShape: LessonPlan = {
  id: null,
  uid: '',
  subject: '',
  grade: '',
  topic: '',
  duration: '45 min',
  objectives: '',
  content: null,
  createdAt: null,
}

export function toFirestore(data: Partial<LessonPlan>): Record<string, unknown> {
  const { id: _id, ...rest } = { ...defaultShape, ...data }
  return omitUndefined(rest)
}

export function fromFirestore(snapshot: DocumentSnapshot): LessonPlan | null {
  const doc = baseFromFirestore(snapshot)
  if (!doc) return null
  return { ...defaultShape, ...doc } as LessonPlan
}
