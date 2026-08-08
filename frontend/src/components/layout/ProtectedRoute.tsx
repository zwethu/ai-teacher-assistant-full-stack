import { Navigate, Outlet } from 'react-router-dom'
import { GraduationCap } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { Button } from '../../design-system'
import LoadingScreen from '../ui/LoadingScreen'

/**
 * The teacher app's front door.
 *
 * Two separate questions, and they used to be collapsed into one. "Is someone
 * signed in?" is not "may they be here": students sign into the same Firebase
 * project to play their assessment game, so before this check any student who
 * had played could open /chat and drive the AI agent on your budget.
 *
 * This guard is for the student's benefit, not for security — the API rejects
 * them regardless (see require_lecturer in backend/utils/deps.py), so without
 * it they would land in an app where every request fails. It exists to say so
 * plainly and give them the way out.
 */
export default function ProtectedRoute() {
  const { user, loading, isLecturer } = useAuth()

  if (loading) {
    return <LoadingScreen label="Signing you in…" />
  }

  if (!user) {
    return <Navigate to="/login" replace />
  }

  if (!isLecturer) {
    return <LecturersOnly />
  }

  return <Outlet />
}

function LecturersOnly() {
  const { user, signOut } = useAuth()

  return (
    <div className="academic-bg fixed inset-0 flex items-center justify-center px-6 font-sans">
      <div className="w-full max-w-md rounded-3xl border border-white/70 bg-white/80 p-8 text-center shadow-lg backdrop-blur-sm">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-violet-100 text-violet-600">
          <GraduationCap className="h-7 w-7" />
        </div>
        <h1 className="mt-5 font-display text-2xl font-bold text-slate-900">
          This area is for lecturers
        </h1>
        <p className="mt-3 text-base leading-relaxed text-slate-600">
          {user?.email ? (
            <>
              <span className="font-semibold text-slate-800">{user.email}</span> isn't set up
              as a lecturer account.
            </>
          ) : (
            <>This account isn't set up as a lecturer account.</>
          )}
        </p>
        {/* Students arrive here by opening a teacher URL out of curiosity, so
            the copy points them back at the thing they actually have: the game
            link their teacher sent. There is no in-app route to it — the link
            carries the assessment id. */}
        <p className="mt-2 text-sm leading-relaxed text-slate-500">
          If you're a student, open the game link your teacher sent you. If you're staff
          and think this is wrong, ask your admin to add your email, then sign in again.
        </p>
        <Button type="button" onClick={signOut} block className="mt-7">
          Sign out
        </Button>
      </div>
    </div>
  )
}
