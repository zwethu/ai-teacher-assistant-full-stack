/**
 * @param {Record<string, unknown>} obj
 */
export function omitUndefined(obj) {
  return Object.fromEntries(
    Object.entries(obj).filter(([, value]) => value !== undefined),
  )
}

/**
 * @param {import('firebase/firestore').DocumentSnapshot} snapshot
 */
export function baseFromFirestore(snapshot) {
  if (!snapshot.exists()) return null
  return {
    id: snapshot.id,
    ...snapshot.data(),
  }
}
