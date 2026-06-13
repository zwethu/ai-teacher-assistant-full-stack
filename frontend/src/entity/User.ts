import type { DocumentSnapshot } from 'firebase/firestore'
import type { BaseDoc, FirestoreTimestamp } from '../types'
import { baseFromFirestore, omitUndefined } from './_helpers'

export interface User extends BaseDoc {
  email: string
  displayName: string
  photoURL: string | null
  googleRefreshToken: string | null
  googleScopes: string[]
  googleConnectedAt: FirestoreTimestamp
}

export const defaultShape: User = {
  id: null,
  uid: '',
  email: '',
  displayName: '',
  photoURL: null,
  googleRefreshToken: null,
  googleScopes: [],
  googleConnectedAt: null,
  createdAt: null,
}

export function toFirestore(data: Partial<User> & Record<string, unknown>): Record<string, unknown> {
  const { id: _id, ...rest } = { ...defaultShape, ...data }
  const cleaned = omitUndefined(rest) as Record<string, unknown>
  if (cleaned.googleRefreshToken === undefined && data.google_refresh_token) {
    cleaned.google_refresh_token = data.google_refresh_token as string
  }
  return cleaned
}

export function fromFirestore(snapshot: DocumentSnapshot): User | null {
  const doc = baseFromFirestore(snapshot)
  if (!doc) return null
  return {
    ...defaultShape,
    ...doc,
    uid: (doc.uid as string) || doc.id,
    googleRefreshToken:
      (doc.googleRefreshToken as string | null) ??
      (doc.google_refresh_token as string | null) ??
      null,
    googleScopes:
      (doc.googleScopes as string[]) ?? (doc.google_scopes as string[]) ?? [],
    googleConnectedAt:
      doc.googleConnectedAt ?? doc.google_connected_at ?? null,
    displayName: (doc.displayName as string) ?? (doc.display_name as string) ?? '',
    photoURL:
      (doc.photoURL as string | null) ?? (doc.photo_url as string | null) ?? null,
  } as User
}
