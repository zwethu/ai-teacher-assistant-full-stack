import api from '../lib/api'
import { auth } from '../lib/firebase'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

export async function checkGooglePermissions(): Promise<{ has_google_scopes: boolean }> {
  const { data } = await api.get<{ has_google_scopes: boolean }>('/auth/check-permissions')
  return {
    has_google_scopes: Boolean(data?.has_google_scopes),
  }
}

export function startGoogleOAuth(): void {
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
