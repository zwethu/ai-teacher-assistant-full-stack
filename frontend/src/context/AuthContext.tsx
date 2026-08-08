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
  /**
   * Whether this account may use the teacher app.
   *
   * A signed-in user is NOT automatically staff: students sign into the same
   * Firebase project to play their game. The answer is a custom claim stamped
   * on the account by the OAuth callback, from the `lecturers` allowlist.
   */
  isLecturer: boolean
  signInWithGoogle: () => void
  signOut: () => Promise<void>
}

const LECTURER_ROLE = 'lecturer'

export const AuthContext = createContext<AuthContextValue | null>(null)

interface AuthProviderProps {
  children: ReactNode
}

/**
 * Read the lecturer claim off the ID token.
 *
 * The cached token is tried first, since for a real lecturer it already carries
 * the claim and a network round trip on every page load would be wasted. Only
 * when the role is absent do we force a refresh — that covers a claim granted
 * out of band (added to the allowlist while the tab was open), and the cost
 * lands on exactly the accounts that are about to be turned away anyway.
 *
 * Any failure resolves to false. A gate that opens when it cannot read the lock
 * is not a gate.
 */
async function readLecturerClaim(user: User): Promise<boolean> {
  try {
    const cached = await user.getIdTokenResult()
    if (cached.claims.role === LECTURER_ROLE) return true
    const fresh = await user.getIdTokenResult(true)
    return fresh.claims.role === LECTURER_ROLE
  } catch {
    return false
  }
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<User | null>(null)
  const [isLecturer, setIsLecturer] = useState(false)
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
      let resolved: User | null = firebaseUser
      if (firebaseUser && !firebaseUser.photoURL) {
        try {
          await firebaseUser.reload()
          resolved = auth.currentUser
        } catch {
          resolved = firebaseUser
        }
      }
      setUser(resolved)
      setIsLecturer(resolved ? await readLecturerClaim(resolved) : false)
      setLoading(false)
    })
    return unsubscribe
  }, [])

  const value = useMemo(
    () => ({
      user,
      loading,
      isLecturer,
      signInWithGoogle,
      signOut,
    }),
    [user, loading, isLecturer, signInWithGoogle, signOut],
  )

  return (
    <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
  )
}
