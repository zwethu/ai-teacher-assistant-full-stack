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

export interface MoodOption {
  value: string
  label: string
  emoji: string
}

export interface MoodStyle {
  pill: string
  text: string
  card: string
}

export type MoodValue =
  | 'great'
  | 'okay'
  | 'tired'
  | 'stressed'
  | 'overwhelmed'
  | 'not_selected'
