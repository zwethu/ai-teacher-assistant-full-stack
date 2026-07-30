import { useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { signInWithCustomToken } from 'firebase/auth'
import { auth } from '../lib/firebase'
import LoadingScreen from '../components/ui/LoadingScreen'

export default function AuthCallback() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()

  useEffect(() => {
    const customToken = searchParams.get('custom_token')
    if (!customToken) {
      navigate('/login', { replace: true })
      return
    }

    signInWithCustomToken(auth, customToken)
      .then(async (credential) => {
        await credential.user.reload()
        // Chat is the front door: every workflow starts from the composer, so
        // signing in lands there rather than on one standalone surface.
        navigate('/chat', { replace: true })
      })
      .catch((err) => {
        console.error('Custom token sign-in failed:', err)
        navigate('/login', { replace: true })
      })
  }, [searchParams, navigate])

  return <LoadingScreen label="Signing you in…" />
}
