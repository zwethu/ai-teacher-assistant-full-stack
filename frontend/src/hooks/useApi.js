import api from '../lib/api.js'

/**
 * Returns the shared axios instance configured for FastAPI.
 * Prefer this in components; the interceptor handles auth headers.
 */
export function useApi() {
  return api
}

export default api
