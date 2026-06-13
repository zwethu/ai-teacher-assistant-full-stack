import type { DocumentSnapshot } from 'firebase/firestore'
import type { BaseDoc } from '../types'
import { baseFromFirestore, omitUndefined } from './_helpers'

export interface Wellness extends BaseDoc {
  mood: string
  notes: string
  date: string
}

export const defaultShape: Wellness = {
  id: null,
  uid: '',
  mood: 'okay',
  notes: '',
  date: '',
  createdAt: null,
}

export function toFirestore(data: Partial<Wellness>): Record<string, unknown> {
  const { id: _id, ...rest } = { ...defaultShape, ...data }
  return omitUndefined(rest)
}

export function fromFirestore(snapshot: DocumentSnapshot): Wellness | null {
  const doc = baseFromFirestore(snapshot)
  if (!doc) return null
  return { ...defaultShape, ...doc } as Wellness
}
