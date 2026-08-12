import axios from 'axios'
import { auth } from './firebase'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:8000',
  withCredentials: true,
})

api.interceptors.request.use(async (config) => {
  const user = auth.currentUser
  if (user) {
    const token = await user.getIdToken()
    config.headers = config.headers ?? {}
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

/* Name of the window event fired when the backend refuses a feature call
   because stress is at 100 (403 with `detail.blocked`). The stress controller
   listens for it and flips the app into the blocked state immediately. */
export const STRESS_BLOCKED_EVENT = 'mila:stress-blocked'

api.interceptors.response.use(undefined, (error) => {
  const detail = error?.response?.data?.detail
  if (
    error?.response?.status === 403 &&
    detail &&
    typeof detail === 'object' &&
    detail.blocked === true
  ) {
    window.dispatchEvent(new CustomEvent(STRESS_BLOCKED_EVENT, { detail }))
  }
  return Promise.reject(error)
})

export default api
