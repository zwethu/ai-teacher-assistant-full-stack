import type { DocumentSnapshot } from 'firebase/firestore'

export function omitUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, value]) => value !== undefined),
  ) as Partial<T>
}

export function baseFromFirestore(
  snapshot: DocumentSnapshot,
): Record<string, unknown> & { id: string } | null {
  if (!snapshot.exists()) return null
  return {
    id: snapshot.id,
    ...snapshot.data(),
  }
}
