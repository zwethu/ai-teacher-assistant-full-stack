import { initializeApp } from 'firebase/app'
import {
  initializeAuth,
  browserLocalPersistence,
  browserSessionPersistence,
  inMemoryPersistence,
  browserPopupRedirectResolver,
} from 'firebase/auth'
import { getDatabase } from 'firebase/database'
import { getFirestore } from 'firebase/firestore'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
}

const requiredKeys = [
  ['VITE_FIREBASE_API_KEY', firebaseConfig.apiKey],
  ['VITE_FIREBASE_AUTH_DOMAIN', firebaseConfig.authDomain],
  ['VITE_FIREBASE_PROJECT_ID', firebaseConfig.projectId],
  ['VITE_FIREBASE_APP_ID', firebaseConfig.appId],
  ['VITE_FIREBASE_DATABASE_URL', firebaseConfig.databaseURL],
] as const

const missing = requiredKeys.filter(([, value]) => !value).map(([name]) => name)
if (missing.length > 0) {
  console.warn(
    `Firebase config incomplete. Set in .env: ${missing.join(', ')}`,
  )
}

export const app = initializeApp(firebaseConfig)
// getAuth() defaults to IndexedDB persistence, which is flaky on some
// devices ("Database is closing" killed sign-in on a tester's Mac,
// 2026-08-13: auth succeeded, persisting the user threw, app bounced
// back to login). localStorage first — reliable everywhere — with
// session/memory as last-resort fallbacks (e.g. storage-blocked modes).
export const auth = initializeAuth(app, {
  persistence: [browserLocalPersistence, browserSessionPersistence, inMemoryPersistence],
  popupRedirectResolver: browserPopupRedirectResolver,
})
export const db = getFirestore(app)
export const rtdb = getDatabase(app)
