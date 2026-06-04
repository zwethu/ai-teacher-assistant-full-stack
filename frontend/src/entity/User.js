import { baseFromFirestore, omitUndefined } from './_helpers.js'

export const defaultShape = {
  id: null,
  uid: '',
  email: '',
  displayName: '',
  credits: 0,
  googleRefreshToken: null,
  googleScopes: [],
  googleConnectedAt: null,
  createdAt: null,
}

export function toFirestore(data) {
  const { id: _id, ...rest } = { ...defaultShape, ...data }
  const cleaned = omitUndefined(rest)
  if (cleaned.googleRefreshToken === undefined && data.google_refresh_token) {
    cleaned.google_refresh_token = data.google_refresh_token
  }
  return cleaned
}

export function fromFirestore(snapshot) {
  const doc = baseFromFirestore(snapshot)
  if (!doc) return null
  return {
    ...defaultShape,
    ...doc,
    uid: doc.uid || doc.id,
    googleRefreshToken:
      doc.googleRefreshToken ?? doc.google_refresh_token ?? null,
    googleScopes: doc.googleScopes ?? doc.google_scopes ?? [],
    googleConnectedAt:
      doc.googleConnectedAt ?? doc.google_connected_at ?? null,
    displayName: doc.displayName ?? doc.display_name ?? '',
  }
}
