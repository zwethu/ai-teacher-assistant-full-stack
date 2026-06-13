import type { DocumentSnapshot } from 'firebase/firestore'
import type { BaseDoc } from '../types'
import { baseFromFirestore, omitUndefined } from './_helpers'

export interface Batch extends BaseDoc {
  name: string
  subject: string
  grade: string
  type: string
  topic: string
  items: unknown[]
  itemCount: number
  content: unknown
}

export const defaultShape: Batch = {
  id: null,
  uid: '',
  name: '',
  subject: '',
  grade: '',
  type: 'Assessment',
  topic: '',
  items: [],
  itemCount: 0,
  content: null,
  createdAt: null,
}

export function toFirestore(data: Partial<Batch>): Record<string, unknown> {
  const { id: _id, ...rest } = { ...defaultShape, ...data }
  return omitUndefined(rest)
}

export function fromFirestore(snapshot: DocumentSnapshot): Batch | null {
  const doc = baseFromFirestore(snapshot)
  if (!doc) return null
  return { ...defaultShape, ...doc } as Batch
}
