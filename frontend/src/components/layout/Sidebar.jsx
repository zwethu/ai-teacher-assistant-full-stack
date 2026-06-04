import { NavLink } from 'react-router-dom'
import {
  Activity,
  BarChart3,
  BookOpen,
  Calendar,
  Home,
  LogOut,
  Mail,
  Menu,
  User,
  Users,
  X,
} from 'lucide-react'
import { useAuth } from '../../hooks/useAuth.js'

const NAV_ITEMS = [
  { to: '/dashboard', label: 'Dashboard', icon: Home, end: true },
  { to: '/assessments', label: 'Assessments', icon: BarChart3 },
  { to: '/lesson-plans', label: 'Lesson Plans', icon: BookOpen },
  { to: '/batches', label: 'Batches', icon: Users },
  { to: '/email', label: 'Send Emails', icon: Mail },
  { to: '/timetable', label: 'Timetable', icon: Calendar },
  { to: '/wellness', label: 'Wellness', icon: Activity },
]

function navLinkClass({ isActive }) {
  if (isActive) {
    return 'relative flex items-center gap-3 px-3 py-2.5 text-sm font-medium rounded-xl whitespace-nowrap group text-emerald-800 bg-gradient-to-r from-emerald-100 to-white border border-emerald-300 shadow-md -translate-y-0.5 transition-all'
  }
  return 'flex items-center gap-3 px-3 py-2.5 text-sm font-medium rounded-xl whitespace-nowrap group text-slate-600 hover:text-slate-900 hover:bg-gradient-to-r hover:from-white hover:via-emerald-50/60 hover:to-white border border-transparent hover:border-slate-200 hover:shadow-sm hover:-translate-y-0.5 transition-all'
}

function NavItems({ showLabels, onNavigate }) {
  return (
    <>
      {NAV_ITEMS.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={navLinkClass}
          onClick={onNavigate}
        >
          {({ isActive }) => (
            <>
              <Icon
                className={`w-5 h-5 flex-shrink-0 transition-colors ${
                  isActive
                    ? 'text-emerald-700'
                    : 'text-slate-500 group-hover:text-emerald-600'
                }`}
              />
              {showLabels && (
                <span className="sidebar-text transition-opacity duration-200">
                  {label}
                </span>
              )}
            </>
          )}
        </NavLink>
      ))}
    </>
  )
}

function ProfileBlock({ collapsed, onSignOut }) {
  const { user } = useAuth()
  const displayName = user?.displayName || 'Profile'
  const email = user?.email || ''
  const photoURL = user?.photoURL

  return (
    <div
      className={`flex items-center gap-3 text-sm rounded-xl hover:bg-slate-50/80 p-2 transition-all duration-300 ${
        collapsed ? 'justify-center' : ''
      }`}
    >
      <div className="flex-shrink-0">
        {photoURL ? (
          <img
            src={photoURL}
            alt=""
            className="w-9 h-9 rounded-full object-cover border-2 border-white shadow-sm"
          />
        ) : (
          <span className="inline-flex items-center justify-center w-9 h-9 rounded-full bg-gradient-to-tr from-blue-500 to-blue-700 text-white shadow-md shadow-blue-300/70">
            <User className="w-5 h-5" />
          </span>
        )}
      </div>
      {!collapsed && (
        <>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-slate-800 truncate">
              {displayName}
            </div>
            <div className="text-xs text-slate-500 truncate">{email}</div>
          </div>
          <button
            type="button"
            onClick={onSignOut}
            className="p-1.5 rounded-md hover:bg-red-50 text-slate-400 hover:text-red-600 transition-colors ml-2"
            title="Logout"
            aria-label="Logout"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </>
      )}
    </div>
  )
}

export default function Sidebar({
  collapsed = false,
  onToggleCollapsed,
  mobileOpen = false,
  onMobileClose,
}) {
  const { signOut } = useAuth()

  async function handleSignOut() {
    if (!window.confirm('Are you sure you want to logout?')) return
    await signOut()
  }

  const sidebarWidth = collapsed ? 'w-20' : 'w-72'

  return (
    <>
      {/* Mobile drawer backdrop */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-sm md:hidden"
          onClick={onMobileClose}
          aria-hidden="true"
        />
      )}

      {/* Mobile drawer */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-full max-w-xs flex-col bg-white pb-4 pt-5 shadow-2xl rounded-r-2xl transition-transform duration-300 md:hidden ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
        aria-hidden={!mobileOpen}
      >
        <div className="absolute top-4 right-4 z-50">
          <button
            type="button"
            onClick={onMobileClose}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-white/90 hover:bg-emerald-50 shadow transition"
            aria-label="Close menu"
          >
            <X className="h-6 w-6 text-slate-700" />
          </button>
        </div>

        <div className="flex flex-shrink-0 items-center px-4 mb-5 mt-2">
          <span className="text-xl font-bold text-slate-900 tracking-tight">
            AI Teaching Companion
          </span>
        </div>

        <nav className="flex-1 space-y-2 px-4 pb-4 overflow-y-auto">
          <NavItems showLabels onNavigate={onMobileClose} />
        </nav>

        <div className="mt-auto px-4 py-3 border-t border-slate-100">
          <ProfileBlock collapsed={false} onSignOut={handleSignOut} />
        </div>
      </aside>

      {/* Desktop sidebar */}
      <aside
        id="mainSidebar"
        className={`hidden md:flex flex-col border-r border-blue-200/60 bg-white/80 backdrop-blur-xl h-screen sticky top-0 transition-all duration-300 ease-in-out shadow-[10px_0_40px_rgba(15,23,42,0.08)] flex-shrink-0 ${sidebarWidth}`}
      >
        <div className="h-16 flex items-center p-6 mt-4 flex-shrink-0 overflow-hidden whitespace-nowrap">
          <span className="flex items-center justify-between w-full">
            {!collapsed && (
              <NavLink
                to="/dashboard"
                className="text-xl font-bold tracking-tight bg-gradient-to-r from-blue-600 to-blue-800 bg-clip-text text-transparent"
              >
                AI Teaching Companion
              </NavLink>
            )}
            {collapsed && (
              <button
                type="button"
                onClick={onToggleCollapsed}
                className="p-1 rounded-lg hover:bg-slate-100 mx-auto"
                aria-label="Expand sidebar"
              >
                <Menu className="w-5 h-5 text-slate-600" />
              </button>
            )}
          </span>
          {!collapsed && (
            <button
              type="button"
              onClick={onToggleCollapsed}
              className="ml-2 p-2 rounded-xl hover:bg-emerald-100 text-slate-500 border border-slate-200/80 transition-all active:scale-95 shadow-sm"
              title="Toggle sidebar"
              aria-label="Toggle sidebar"
            >
              <Menu className="w-5 h-5" />
            </button>
          )}
        </div>

        <nav className="flex-1 p-4 space-y-2 overflow-y-auto overflow-x-hidden">
          <NavItems showLabels={!collapsed} />
        </nav>

        {!collapsed && (
          <div className="px-4 py-3 border-t border-slate-100 flex-shrink-0">
            <NavLink
              to="/wellness"
              className="w-full text-left hover:bg-slate-50 rounded-xl p-2 transition-colors group block"
            >
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-semibold text-slate-500 flex items-center gap-1.5 group-hover:text-slate-700">
                  <Activity className="w-3.5 h-3.5" />
                  Stress Level
                </span>
                <span className="text-xs font-bold text-emerald-600">Low</span>
              </div>
              <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full bg-emerald-400 transition-all duration-700"
                  style={{ width: '0%' }}
                />
              </div>
            </NavLink>
          </div>
        )}

        <div className="px-4 py-4 border-t border-slate-100 flex-shrink-0">
          <ProfileBlock collapsed={collapsed} onSignOut={handleSignOut} />
        </div>
      </aside>
    </>
  )
}
