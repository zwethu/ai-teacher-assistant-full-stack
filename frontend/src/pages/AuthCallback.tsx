import { useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { signInWithCustomToken } from 'firebase/auth'
import { auth } from '../lib/firebase'
import PageSpinner from '../components/ui/PageSpinner'

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
      .then(() => {
        navigate('/assessments', { replace: true })
      })
      .catch((err) => {
        console.error('Custom token sign-in failed:', err)
        navigate('/login', { replace: true })
      })
  }, [searchParams, navigate])

  return <PageSpinner label="Signing you in…" />
}
