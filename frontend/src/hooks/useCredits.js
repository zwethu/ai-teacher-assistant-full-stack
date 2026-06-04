import { useEffect, useState } from 'react'
import { doc, onSnapshot } from 'firebase/firestore'
import { db } from '../lib/firebase.js'
import { useAuth } from './useAuth.js'

export function useCredits() {
  const { user } = useAuth()
  const [credits, setCredits] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user?.uid) {
      setCredits(0)
      setLoading(false)
      return undefined
    }

    setLoading(true)
    const userRef = doc(db, 'users', user.uid)

    const unsubscribe = onSnapshot(
      userRef,
      (snapshot) => {
        const data = snapshot.data()
        setCredits(typeof data?.credits === 'number' ? data.credits : 0)
        setLoading(false)
      },
      (error) => {
        console.error('Failed to load credits:', error)
        setCredits(0)
        setLoading(false)
      },
    )

    return unsubscribe
  }, [user?.uid])

  return { credits, loading }
}
