import { useEffect, useState } from 'react'
import { collection, onSnapshot, query, where } from 'firebase/firestore'
import type { DocumentSnapshot } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { toDate } from '../utils/formatDate'

const LOAD_TIMEOUT_MS = 15_000

function sortByField<T extends object>(
  items: T[],
  field: string,
  desc = true,
): T[] {
  return [...items].sort((a, b) => {
    const aTime = toDate((a as Record<string, unknown>)[field])?.getTime() ?? 0
    const bTime = toDate((b as Record<string, unknown>)[field])?.getTime() ?? 0
    return desc ? bTime - aTime : aTime - bTime
  })
}

interface UseUserCollectionOptions<T> {
  collectionName: string
  uid: string | undefined
  fromFirestore: (snapshot: DocumentSnapshot) => T | null
  sortField?: string
  sortDesc?: boolean
}

export function useUserCollection<T extends object>({
  collectionName,
  uid,
  fromFirestore,
  sortField = 'createdAt',
  sortDesc = true,
}: UseUserCollectionOptions<T>) {
  const [items, setItems] = useState<T[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!uid) {
      setItems([])
      setLoading(false)
      setError(null)
      return undefined
    }

    setLoading(true)
    setError(null)

    let settled = false
    const settle = (fn: () => void) => {
      if (settled) return
      settled = true
      fn()
    }

    const timeoutId = window.setTimeout(() => {
      settle(() => {
        setLoading(false)
        setError(
          'Loading timed out. Check your network, Firestore rules, and that Firestore is enabled for this Firebase project.',
        )
      })
    }, LOAD_TIMEOUT_MS)

    const q = query(
      collection(db, collectionName),
      where('uid', '==', uid),
    )

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        try {
          const docs = snapshot.docs
            .map((d) => fromFirestore(d))
            .filter((d): d is T => d !== null)
          setItems(sortByField(docs, sortField, sortDesc))
          settle(() => setLoading(false))
        } catch (err) {
          console.error(`Failed to parse ${collectionName}:`, err)
          settle(() => {
            setLoading(false)
            setError('Could not read data from Firestore.')
          })
        }
      },
      (err: { code?: string }) => {
        console.error(`Failed to load ${collectionName}:`, err)
        const message =
          err?.code === 'permission-denied'
            ? 'Permission denied. Update Firestore security rules to allow reads for your user.'
            : 'Could not load data. Check the browser console and Firestore configuration.'
        settle(() => {
          setLoading(false)
          setError(message)
        })
      },
    )

    return () => {
      window.clearTimeout(timeoutId)
      unsubscribe()
    }
  }, [collectionName, uid, sortField, sortDesc, fromFirestore])

  return { items, loading, error }
}
