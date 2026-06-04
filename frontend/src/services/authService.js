import api from '../lib/api.js'
import { auth } from '../lib/firebase.js'

const API_URL =
  import.meta.env.VITE_API_URL || 'http://localhost:8000/api'

/**
 * @returns {Promise<{ has_google_scopes: boolean }>}
 */
export async function checkGooglePermissions() {
  const { data } = await api.get('/auth/check-permissions')
  return {
    has_google_scopes: Boolean(data?.has_google_scopes),
  }
}

/**
 * Redirect to FastAPI Google OAuth (requires Firebase session).
 */
export function startGoogleOAuth() {
  const user = auth.currentUser
  if (!user) {
    window.location.href = `${API_URL}/auth/google-scopes`
    return
  }

  user.getIdToken(true).then((token) => {
    const url = new URL(`${API_URL}/auth/google-scopes`)
    url.searchParams.set('firebase_token', token)
    window.location.href = url.toString()
  })
}
