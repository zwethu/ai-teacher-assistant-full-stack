/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FIREBASE_API_KEY: string
  readonly VITE_FIREBASE_AUTH_DOMAIN: string
  readonly VITE_FIREBASE_PROJECT_ID: string
  readonly VITE_FIREBASE_APP_ID: string
  readonly VITE_API_URL: string
  readonly VITE_AGENT_ENGINE_URL: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
