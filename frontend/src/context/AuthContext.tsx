import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {
  onAuthStateChanged,
  signOut as firebaseSignOut,
  type User,
} from 'firebase/auth'
import { auth } from '../lib/firebase'

export interface AuthContextValue {
  user: User | null
  loading: boolean
  signInWithGoogle: () => void
  signOut: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)

interface AuthProviderProps {
  children: ReactNode
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  const signInWithGoogle = useCallback(() => {
    const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:8000'
    window.location.href = `${apiUrl}/auth/google-scopes`
  }, [])

  const signOut = useCallback(async () => {
    await firebaseSignOut(auth)
  }, [])

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser && !firebaseUser.photoURL) {
        try {
          await firebaseUser.reload()
          setUser(auth.currentUser)
        } catch {
          setUser(firebaseUser)
        }
      } else {
        setUser(firebaseUser)
      }
      setLoading(false)
    })
    return unsubscribe
  }, [])

  const value = useMemo(
    () => ({
      user,
      loading,
      signInWithGoogle,
      signOut,
    }),
    [user, loading, signInWithGoogle, signOut],
  )

  return (
    <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
  )
}
