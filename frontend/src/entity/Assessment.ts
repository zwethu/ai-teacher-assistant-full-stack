import type { DocumentSnapshot } from 'firebase/firestore'
import type { BaseDoc } from '../types'
import { baseFromFirestore, omitUndefined } from './_helpers'

export interface Assessment extends BaseDoc {
  subject: string
  grade: string
  topic: string
  difficulty: string
  content: unknown
}

export const defaultShape: Assessment = {
  id: null,
  uid: '',
  subject: '',
  grade: '',
  topic: '',
  difficulty: 'Medium',
  content: null,
  createdAt: null,
}

export function toFirestore(data: Partial<Assessment>): Record<string, unknown> {
  const { id: _id, ...rest } = { ...defaultShape, ...data }
  return omitUndefined(rest)
}

export function fromFirestore(snapshot: DocumentSnapshot): Assessment | null {
  const doc = baseFromFirestore(snapshot)
  if (!doc) return null
  return { ...defaultShape, ...doc } as Assessment
}
