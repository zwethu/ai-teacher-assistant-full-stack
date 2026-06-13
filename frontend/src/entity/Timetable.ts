import type { DocumentSnapshot } from 'firebase/firestore'
import type { BaseDoc } from '../types'
import { baseFromFirestore, omitUndefined } from './_helpers'

export interface Timetable extends BaseDoc {
  day: string
  period: string
  subject: string
  classroom: string
  notes: string
}

export const defaultShape: Timetable = {
  id: null,
  uid: '',
  day: '',
  period: '',
  subject: '',
  classroom: '',
  notes: '',
  createdAt: null,
}

export function toFirestore(data: Partial<Timetable>): Record<string, unknown> {
  const { id: _id, ...rest } = { ...defaultShape, ...data }
  return omitUndefined(rest)
}

export function fromFirestore(snapshot: DocumentSnapshot): Timetable | null {
  const doc = baseFromFirestore(snapshot)
  if (!doc) return null
  return { ...defaultShape, ...doc } as Timetable
}
