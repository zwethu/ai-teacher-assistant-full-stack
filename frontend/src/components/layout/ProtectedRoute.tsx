import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import PageSpinner from '../ui/PageSpinner'

export default function ProtectedRoute() {
  const { user, loading } = useAuth()

  if (loading) {
    return <PageSpinner />
  }

  if (!user) {
    return <Navigate to="/login" replace />
  }

  return <Outlet />
}
