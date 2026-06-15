import { useEffect, useRef, useState } from 'react'
import { NavLink } from 'react-router-dom'
import type { LucideIcon } from 'lucide-react'
import {
  Activity,
  BarChart3,
  BookOpen,
  ChevronDown,
  Clock,
  LogOut,
  Mail,
  Menu,
  MessageCircle,
  User,
  Users,
  X,
} from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { getStress, type StressState } from '../../services/wellnessService'
import WellnessPopover from '../wellness/WellnessPopover'
import { SessionsNavItem } from './SessionsNavItem'

const NAV_ITEMS: {
  to: string
  label: string
  icon: LucideIcon
  end?: boolean
}[] = [
  { to: '/chat', label: 'Chat', icon: MessageCircle, end: true },
  { to: '/batches', label: 'Batches', icon: Users },
  { to: '/lesson-plans', label: 'Lesson Plans', icon: BookOpen },
  { to: '/assessments', label: 'Assessments', icon: BarChart3 },
  { to: '/email', label: 'Send Emails', icon: Mail },
  { to: '/chat-history', label: 'Sessions', icon: Clock },
]

function stressLabel(score: number): string {
  if (score >= 100) return 'Max'
  if (score >= 80) return 'High'
  return 'Low'
}

function stressBarColor(score: number): string {
  if (score >= 100) return 'bg-red-500'
  if (score >= 80) return 'bg-orange-500'
  return 'bg-emerald-400'
}

function stressLabelColor(score: number): string {
  if (score >= 100) return 'text-red-600'
  if (score >= 80) return 'text-orange-600'
  return 'text-emerald-600'
}

interface StressWidgetProps {
  uid: string
}

function StressWidget({ uid }: StressWidgetProps) {
  const [expanded, setExpanded] = useState(false)
  const [stress, setStress] = useState<StressState | null>(null)

  async function refreshStress() {
    try {
      setStress(await getStress(uid))
    } catch (err) {
      console.error('Failed to load stress:', err)
    }
  }

  useEffect(() => {
    refreshStress()
  }, [uid])

  const score = stress?.stress_score ?? 0

  return (
    <div
      className={`rounded-xl transition-colors ${
        expanded ? 'bg-slate-50 border border-slate-200' : 'hover:bg-slate-50'
      }`}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full text-left rounded-xl p-2 transition-colors group"
        aria-expanded={expanded}
      >
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs font-semibold text-slate-500 flex items-center gap-1.5 group-hover:text-slate-700">
            <Activity className="w-3.5 h-3.5" />
            Stress Level
          </span>
          <span className="flex items-center gap-1.5">
            <span className={`text-xs font-bold ${stressLabelColor(score)}`}>
              {stressLabel(score)}
            </span>
            <ChevronDown
              className={`w-3.5 h-3.5 text-slate-400 transition-transform ${
                expanded ? 'rotate-180' : ''
              }`}
            />
          </span>
        </div>
        <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-700 ${stressBarColor(score)}`}
            style={{ width: `${score}%` }}
          />
        </div>
      </button>

      {expanded && (
        <div className="px-2 pb-3 pt-1 border-t border-slate-200/80">
          <WellnessPopover
            uid={uid}
            embedded
            onStressUpdate={refreshStress}
          />
        </div>
      )}
    </div>
  )
}

function navLinkClass(
  { isActive }: { isActive: boolean },
  showLabels: boolean,
): string {
  const layout = showLabels
    ? 'gap-3 px-3 py-2.5 w-full'
    : 'justify-center items-center p-2 w-10 h-10 mx-auto shrink-0'

  if (isActive) {
    const activeBg = showLabels
      ? 'bg-gradient-to-r from-emerald-100 to-white'
      : 'bg-emerald-100/90'
    return `relative flex items-center ${layout} text-sm font-medium rounded-xl whitespace-nowrap group text-emerald-800 ${activeBg} border border-emerald-300 shadow-md -translate-y-0.5 transition-all`
  }
  return `flex items-center ${layout} text-sm font-medium rounded-xl whitespace-nowrap group text-slate-600 hover:text-slate-900 hover:bg-gradient-to-r hover:from-white hover:via-emerald-50/60 hover:to-white border border-transparent hover:border-slate-200 hover:shadow-sm hover:-translate-y-0.5 transition-all`
}

interface NavItemsProps {
  showLabels: boolean
  collapsed?: boolean
  onNavigate?: () => void
}

function NavItems({ showLabels, collapsed = false, onNavigate }: NavItemsProps) {
  return (
    <>
      {NAV_ITEMS.map(({ to, label, icon: Icon, end }) => {
        if (to === '/chat-history') {
          return (
            <SessionsNavItem
              key={to}
              showLabels={showLabels}
              collapsed={collapsed}
              onNavigate={onNavigate}
            />
          )
        }

        return (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={(props) => navLinkClass(props, showLabels)}
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
        )
      })}
    </>
  )
}

interface ProfileBlockProps {
  collapsed: boolean
  onSignOut: () => void
}

function ProfileAvatar({ photoURL }: { photoURL?: string | null }) {
  if (photoURL) {
    return (
      <img
        src={photoURL}
        alt=""
        className="w-9 h-9 rounded-full object-cover border-2 border-white shadow-sm"
      />
    )
  }
  return (
    <span className="inline-flex items-center justify-center w-9 h-9 rounded-full bg-gradient-to-tr from-blue-500 to-blue-700 text-white shadow-md shadow-blue-300/70">
      <User className="w-5 h-5" />
    </span>
  )
}

function ProfileBlock({ collapsed, onSignOut }: ProfileBlockProps) {
  const { user } = useAuth()
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const displayName = user?.displayName || 'Profile'
  const email = user?.email || ''
  const photoURL = user?.photoURL

  useEffect(() => {
    if (!menuOpen) return undefined
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [menuOpen])

  async function handleSignOut() {
    setMenuOpen(false)
    await onSignOut()
  }

  if (collapsed) {
    return (
      <div ref={menuRef} className="relative flex justify-center">
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          className="rounded-full p-0.5 hover:ring-2 hover:ring-emerald-200 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
          aria-label="Open profile menu"
          aria-expanded={menuOpen}
          aria-haspopup="menu"
        >
          <ProfileAvatar photoURL={photoURL} />
        </button>

        {menuOpen && (
          <div
            role="menu"
            className="absolute left-full bottom-0 ml-3 w-56 rounded-xl border border-slate-200 bg-white py-2 shadow-xl z-[60]"
          >
            <div className="px-4 py-2 border-b border-slate-100">
              <div className="text-sm font-semibold text-slate-800 truncate">
                {displayName}
              </div>
              {email && (
                <div className="text-xs text-slate-500 truncate">{email}</div>
              )}
            </div>
            <button
              type="button"
              role="menuitem"
              onClick={handleSignOut}
              className="flex w-full items-center gap-2 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 transition-colors"
            >
              <LogOut className="w-4 h-4" />
              Logout
            </button>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="flex items-center gap-3 text-sm rounded-xl hover:bg-slate-50/80 p-2 transition-all duration-300">
      <div className="flex-shrink-0">
        <ProfileAvatar photoURL={photoURL} />
      </div>
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
    </div>
  )
}

interface SidebarProps {
  collapsed?: boolean
  onToggleCollapsed: () => void
  mobileOpen?: boolean
  onMobileClose: () => void
}

export default function Sidebar({
  collapsed = false,
  onToggleCollapsed,
  mobileOpen = false,
  onMobileClose,
}: SidebarProps) {
  const { user, signOut } = useAuth()
  const uid = user?.uid

  async function handleSignOut() {
    if (!window.confirm('Are you sure you want to logout?')) return
    await signOut()
  }

  const sidebarWidth = collapsed ? 'w-20' : 'w-72'

  return (
    <>
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-sm md:hidden"
          onClick={onMobileClose}
          aria-hidden="true"
        />
      )}

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

        <div className="flex flex-shrink-0 items-center px-6 pt-6 pb-4 pr-14">
          <span className="text-lg font-bold text-slate-900 tracking-tight leading-snug">
            AI Teaching Companion
          </span>
        </div>

        <nav className="flex-1 space-y-2 px-5 pt-2 pb-4 overflow-y-auto">
          <NavItems showLabels onNavigate={onMobileClose} collapsed={false} />
        </nav>

        {uid && (
          <div className="px-5 py-4 border-t border-slate-100">
            <StressWidget uid={uid} />
          </div>
        )}

        <div className="mt-auto px-5 py-4 border-t border-slate-100">
          <ProfileBlock collapsed={false} onSignOut={handleSignOut} />
        </div>
      </aside>

      <aside
        id="mainSidebar"
        className={`hidden md:flex flex-col border-r border-blue-200/60 bg-white/80 backdrop-blur-xl h-screen sticky top-0 transition-all duration-300 ease-in-out shadow-[10px_0_40px_rgba(15,23,42,0.08)] flex-shrink-0 ${sidebarWidth}`}
      >
        <div className={`flex-shrink-0 pt-6 pb-5 ${collapsed ? 'px-2' : 'px-5'}`}>
          <div
            className={`flex items-center min-w-0 ${
              collapsed ? 'justify-center' : 'justify-between gap-3'
            }`}
          >
            {!collapsed && (
              <NavLink
                to="/chat"
                className="min-w-0 flex-1 text-lg font-bold leading-snug tracking-tight text-slate-900"
              >
                AI Teaching Companion
              </NavLink>
            )}
            <button
              type="button"
              onClick={onToggleCollapsed}
              className={`flex-shrink-0 p-2.5 rounded-xl hover:bg-emerald-100 text-slate-500 border border-slate-200/80 transition-all active:scale-95 shadow-sm ${
                collapsed ? 'mx-auto' : ''
              }`}
              title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              <Menu className="w-5 h-5" />
            </button>
          </div>
        </div>

        <nav className={`flex-1 pt-2 pb-4 space-y-2 overflow-y-auto overflow-x-hidden ${collapsed ? 'px-0 flex flex-col items-center' : 'px-5'}`}>
          <NavItems showLabels={!collapsed} collapsed={collapsed} />
        </nav>

        {!collapsed && uid && (
          <div className="px-5 py-4 border-t border-slate-100 flex-shrink-0">
            <StressWidget uid={uid} />
          </div>
        )}

        <div className={`border-t border-slate-100 flex-shrink-0 overflow-visible ${collapsed ? 'px-2 py-5' : 'px-5 py-5'}`}>
          <ProfileBlock collapsed={collapsed} onSignOut={handleSignOut} />
        </div>
      </aside>
    </>
  )
}
