import type { DocumentSnapshot } from 'firebase/firestore'
import type { BaseDoc, FirestoreTimestamp } from '../types'
import { baseFromFirestore, omitUndefined } from './_helpers'

export interface Email extends BaseDoc {
  to: string
  subject: string
  body: string
  status: string
  sendAt: FirestoreTimestamp
  sentAt: FirestoreTimestamp
}

export const defaultShape: Email = {
  id: null,
  uid: '',
  to: '',
  subject: '',
  body: '',
  status: 'pending',
  sendAt: null,
  sentAt: null,
  createdAt: null,
}

export function toFirestore(data: Partial<Email>): Record<string, unknown> {
  const { id: _id, ...rest } = { ...defaultShape, ...data }
  return omitUndefined(rest)
}

export function fromFirestore(snapshot: DocumentSnapshot): Email | null {
  const doc = baseFromFirestore(snapshot)
  if (!doc) return null
  return { ...defaultShape, ...doc } as Email
}
