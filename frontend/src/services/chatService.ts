import {
  addDoc,
  collection,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
} from 'firebase/firestore'
import { db } from '../lib/firebase'
import type { ChatMessage } from '../entity/Chat'

const CHATS_COLLECTION = 'chats'

export async function createChat(
  uid: string,
  batchId: string,
  batchLabel: string,
): Promise<string> {
  const ref = collection(db, CHATS_COLLECTION)
  const docRef = await addDoc(ref, {
    uid,
    batchId,
    batchLabel,
    title: batchLabel,
    createdAt: serverTimestamp(),
  })
  return docRef.id
}

export async function getMessages(chatId: string): Promise<ChatMessage[]> {
  const ref = collection(db, CHATS_COLLECTION, chatId, 'messages')
  const q = query(ref, orderBy('createdAt', 'asc'))
  const snap = await getDocs(q)
  return snap.docs.map((d) => {
    const data = d.data()
    return {
      id: d.id,
      role: data.role as 'user' | 'assistant',
      content: data.content ?? '',
      createdAt: data.createdAt ? data.createdAt.toDate?.() ?? null : null,
    }
  })
}

export async function addMessage(
  chatId: string,
  role: 'user' | 'assistant',
  content: string,
): Promise<void> {
  const ref = collection(db, CHATS_COLLECTION, chatId, 'messages')
  await addDoc(ref, {
    role,
    content,
    createdAt: serverTimestamp(),
  })
}
