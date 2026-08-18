import type { DocumentSnapshot, FieldValue, Timestamp } from 'firebase/firestore'

export type FirestoreTimestamp =
  | Timestamp
  | Date
  | string
  | number
  | null
  | undefined
  | FieldValue

export interface BaseDoc {
  id: string | null
  uid: string
  createdAt: FirestoreTimestamp
}

export type FromFirestore<T> = (snapshot: DocumentSnapshot) => T | null

export interface ToastMessage {
  type: 'error' | 'success'
  message: string
}
