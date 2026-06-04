import { baseFromFirestore, omitUndefined } from './_helpers.js'

export const defaultShape = {
  id: null,
  uid: '',
  subject: '',
  grade: '',
  topic: '',
  duration: '45 min',
  objectives: '',
  content: null,
  createdAt: null,
}

export function toFirestore(data) {
  const { id: _id, ...rest } = { ...defaultShape, ...data }
  return omitUndefined(rest)
}

export function fromFirestore(snapshot) {
  const doc = baseFromFirestore(snapshot)
  if (!doc) return null
  return { ...defaultShape, ...doc }
}
