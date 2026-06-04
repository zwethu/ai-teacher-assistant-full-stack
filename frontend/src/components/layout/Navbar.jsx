import { Menu, Coins, LogOut } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth.js'
import { useCredits } from '../../hooks/useCredits.js'

const PAGE_TITLES = {
  '/dashboard': 'Dashboard',
  '/assessments': 'Assessments',
  '/lesson-plans': 'Lesson Plans',
  '/batches': 'Batches',
  '/email': 'Send Emails',
  '/timetable': 'Timetable',
  '/wellness': 'Wellness',
}

export default function Navbar({ title, onOpenMobileMenu }) {
  const { user, signOut } = useAuth()
  const { credits, loading: creditsLoading } = useCredits()

  const displayName = user?.displayName || 'Profile'
  const photoURL = user?.photoURL
  const pageTitle = title || 'Dashboard'

  async function handleSignOut() {
    if (!window.confirm('Are you sure you want to logout?')) return
    await signOut()
  }

  return (
    <>
      {/* Mobile header */}
      <header className="md:hidden h-16 bg-white/80 backdrop-blur-xl border-b border-blue-200/60 flex items-center justify-between px-4 sticky top-0 z-20 shadow-[0_4px_20px_rgba(148,163,184,0.35)]">
        <button
          type="button"
          onClick={onOpenMobileMenu}
          className="inline-flex items-center justify-center p-2 rounded-lg text-slate-600 hover:bg-blue-50"
          aria-label="Open menu"
        >
          <Menu className="h-6 w-6" />
        </button>
        <h1 className="text-lg font-bold text-slate-900 tracking-tight truncate px-2">
          {pageTitle}
        </h1>
        <div className="flex items-center gap-2 flex-shrink-0">
          {!creditsLoading && (
            <span className="text-xs font-bold text-emerald-700 bg-emerald-50 px-2 py-1 rounded-lg">
              {credits}
            </span>
          )}
          {photoURL ? (
            <img
              src={photoURL}
              alt=""
              className="w-8 h-8 rounded-full object-cover border border-white shadow-sm"
            />
          ) : (
            <span className="w-8 h-8 rounded-full bg-blue-600 text-white text-xs flex items-center justify-center font-bold">
              {displayName.charAt(0)}
            </span>
          )}
        </div>
      </header>

      {/* Desktop top bar */}
      <header className="hidden md:flex h-16 items-center justify-between px-6 lg:px-8 border-b border-blue-200/40 bg-white/60 backdrop-blur-md flex-shrink-0">
        <h1 className="text-xl font-bold text-slate-900 tracking-tight">{pageTitle}</h1>

        <div className="flex items-center gap-4">
          <div
            className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-emerald-50 border border-emerald-100 text-emerald-800"
            title="Credit balance"
          >
            <Coins className="w-4 h-4 text-emerald-600" />
            <span className="text-sm font-bold tabular-nums">
              {creditsLoading ? '…' : credits}
            </span>
            <span className="text-xs text-emerald-600 font-medium">credits</span>
          </div>

          <div className="flex items-center gap-3 pl-2 border-l border-slate-200">
            {photoURL ? (
              <img
                src={photoURL}
                alt=""
                className="w-9 h-9 rounded-full object-cover border-2 border-white shadow-sm"
              />
            ) : (
              <span className="inline-flex items-center justify-center w-9 h-9 rounded-full bg-gradient-to-tr from-blue-500 to-blue-700 text-white text-sm font-bold">
                {displayName.charAt(0)}
              </span>
            )}
            <div className="hidden lg:block min-w-0">
              <p className="text-sm font-semibold text-slate-800 truncate max-w-[160px]">
                {displayName}
              </p>
              <p className="text-xs text-slate-500 truncate max-w-[160px]">
                {user?.email}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleSignOut}
            className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-slate-600 hover:text-red-600 hover:bg-red-50 rounded-xl transition-colors"
          >
            <LogOut className="w-4 h-4" />
            <span className="hidden sm:inline">Sign out</span>
          </button>
        </div>
      </header>
    </>
  )
}

export function getPageTitle(pathname) {
  if (PAGE_TITLES[pathname]) return PAGE_TITLES[pathname]
  const match = Object.entries(PAGE_TITLES).find(([path]) =>
    pathname.startsWith(path),
  )
  return match?.[1] ?? 'Dashboard'
}
