import { baseFromFirestore, omitUndefined } from './_helpers.js'

export const defaultShape = {
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

export function toFirestore(data) {
  const { id: _id, ...rest } = { ...defaultShape, ...data }
  return omitUndefined(rest)
}

export function fromFirestore(snapshot) {
  const doc = baseFromFirestore(snapshot)
  if (!doc) return null
  return { ...defaultShape, ...doc }
}
