import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import LoadingScreen from '../ui/LoadingScreen'

export default function ProtectedRoute() {
  const { user, loading } = useAuth()

  if (loading) {
    return <LoadingScreen label="Signing you in…" />
  }

  if (!user) {
    return <Navigate to="/login" replace />
  }

  return <Outlet />
}
