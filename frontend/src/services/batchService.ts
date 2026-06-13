import {
  collection,
  doc,
  getDocs,
  getCountFromServer,
  addDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  serverTimestamp,
} from 'firebase/firestore'
import { db } from '../lib/firebase'
import type { Batch, BatchStudent } from '../entity/Batch'

const BATCHES_COLLECTION = 'batches'

export async function listBatches(uid: string): Promise<Batch[]> {
  const ref = collection(db, BATCHES_COLLECTION)
  const q = query(ref, where('uid', '==', uid), orderBy('createdAt', 'desc'))
  const snap = await getDocs(q)
  return snap.docs.map((d) => {
    const data = d.data()
    return {
      id: d.id,
      uid: data.uid,
      label: data.label ?? '',
      createdAt: data.createdAt ? data.createdAt.toDate?.() ?? null : null,
    }
  })
}

export async function createBatch(uid: string, label: string): Promise<string> {
  const ref = collection(db, BATCHES_COLLECTION)
  const docRef = await addDoc(ref, {
    uid,
    label,
    createdAt: serverTimestamp(),
  })
  return docRef.id
}

export async function deleteBatch(batchId: string): Promise<void> {
  const studentsRef = collection(db, BATCHES_COLLECTION, batchId, 'students')
  const studentsSnap = await getDocs(studentsRef)
  await Promise.all(studentsSnap.docs.map((d) => deleteDoc(d.ref)))

  const batchRef = doc(db, BATCHES_COLLECTION, batchId)
  await deleteDoc(batchRef)
}

export async function getBatchStudentCount(batchId: string): Promise<number> {
  const studentsRef = collection(db, BATCHES_COLLECTION, batchId, 'students')
  const snap = await getCountFromServer(studentsRef)
  return snap.data().count
}

export async function listBatchStudents(batchId: string): Promise<BatchStudent[]> {
  const studentsRef = collection(db, BATCHES_COLLECTION, batchId, 'students')
  const q = query(studentsRef, orderBy('createdAt', 'asc'))
  const snap = await getDocs(q)
  return snap.docs.map((d) => {
    const data = d.data()
    return {
      id: d.id,
      name: data.name ?? '',
      email: data.email ?? '',
      createdAt: data.createdAt ? data.createdAt.toDate?.() ?? null : null,
    }
  })
}

export async function addStudentToBatch(
  batchId: string,
  name: string,
  email: string,
): Promise<void> {
  const studentsRef = collection(db, BATCHES_COLLECTION, batchId, 'students')
  await addDoc(studentsRef, {
    name,
    email,
    createdAt: serverTimestamp(),
  })
}

export async function removeStudentFromBatch(
  batchId: string,
  studentId: string,
): Promise<void> {
  const studentRef = doc(db, BATCHES_COLLECTION, batchId, 'students', studentId)
  await deleteDoc(studentRef)
}
