import { doc, getDoc, serverTimestamp, setDoc, Timestamp } from 'firebase/firestore'
import { db } from '../lib/firebase'

/**
 * The per-account terms acceptance record, on `users/{uid}`.
 *
 * That document is created by the backend OAuth callback (routers/auth.py) with
 * merge writes, and the Firestore rules let the signed-in lecturer read and
 * update their own copy — so the record can live client-side with no new
 * backend surface. The fields here are the only ones the frontend touches.
 */

export interface TermsAcceptance {
  version: string | null
  acceptedAt: Timestamp | null
}

export async function getTermsAcceptance(uid: string): Promise<TermsAcceptance> {
  const snap = await getDoc(doc(db, 'users', uid))
  if (!snap.exists()) return { version: null, acceptedAt: null }
  const data = snap.data()
  return {
    version: typeof data.termsVersion === 'string' ? data.termsVersion : null,
    acceptedAt: data.termsAcceptedAt instanceof Timestamp ? data.termsAcceptedAt : null,
  }
}

/**
 * Record acceptance. Merge-set rather than update: the doc normally exists
 * (the OAuth callback writes it), but a merge is correct either way and the
 * rules allow both create and update. No `uid` field — the `users` rule keys
 * on the document id, not on a field.
 */
export async function acceptTerms(uid: string, version: string): Promise<void> {
  await setDoc(
    doc(db, 'users', uid),
    { termsVersion: version, termsAcceptedAt: serverTimestamp() },
    { merge: true },
  )
}
