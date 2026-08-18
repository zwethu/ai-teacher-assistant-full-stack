import { useEffect, useRef, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { MilaLogo } from '../brand/MilaLogo'
import type { LucideIcon } from 'lucide-react'
import {
  Activity,
  History,
  LogOut,
  Mail,
  Menu,
  MessageCircle,
  User,
  Users,
  X,
} from 'lucide-react'
import { confirm } from '../ui/confirmStore'
import { useAuth } from '../../hooks/useAuth'
import { ARTIFACT_ICONS } from '../../utils/artifactIcons'
import { useStress } from '../../context/StressContext'
import { LEVEL_FILL, LEVEL_TEXT, levelWord } from '../wellness/stressLevel'
const NAV_ITEMS: {
  to: string
  label: string
  icon: LucideIcon
  end?: boolean
}[] = [
  { to: '/chat', label: 'Chat', icon: MessageCircle, end: true },
  { to: '/batches', label: 'Batches', icon: Users },
  { to: '/course-plans', label: 'Course Plans', icon: ARTIFACT_ICONS.course_blueprint },
  { to: '/lesson-plans', label: 'Lesson Plans', icon: ARTIFACT_ICONS.lesson_plan },
  { to: '/assessments', label: 'Assessments', icon: ARTIFACT_ICONS.assessment },
  { to: '/email', label: 'Send Emails', icon: Mail },
  { to: '/games', label: 'Games', icon: ARTIFACT_ICONS.game },
  { to: '/chat-history', label: 'Chat History', icon: History },
]

/**
 * The meter, in the sidebar where it has always been.
 *
 * Clicking it used to unfold a panel inside the rail — a 200px-tall wellness
 * app squeezed into a 240px column, under everything else the sidebar is for.
 * It opens a dialog now: the same two things (breathe, read the journal) with
 * room to be read, and the rail stays a rail.
 */
function StressWidget() {
  const { stress, openWellness } = useStress()

  const score = stress?.stress_score ?? 0
  const level = stress?.level ?? 'low'

  return (
    <div data-stress-ui className="rounded-xl transition-colors hover:bg-slate-50">
      <button
        type="button"
        onClick={openWellness}
        className="group w-full rounded-xl p-2 text-left transition-colors"
        aria-label={`Stress level ${levelWord(level)}, ${Math.round(score)} of 100. Open wellness.`}
      >
        <div className="mb-1.5 flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 group-hover:text-slate-700">
            <Activity className="w-3.5 h-3.5" />
            Stress Level
          </span>
          <span className={`text-xs font-bold ${LEVEL_TEXT[level]}`}>
            {levelWord(level)}
          </span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
          {/* Depth is the amount and width is the amount, so the two agree even
              at a glance from across a desk. Pinned at the ceiling the bar
              breathes — the only motion in the rail, and the one state worth
              interrupting someone for. */}
          <div
            className={`h-full rounded-full transition-all duration-700 ${
              level === 'max' ? 'mila-stress-pulse' : ''
            }`}
            style={{
              width: `${Math.max(2, Math.min(100, score))}%`,
              backgroundImage: LEVEL_FILL[level],
            }}
          />
        </div>
      </button>
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

  /* The main navigation had no focus styling of any kind — a keyboard user
     tabbing down it saw nothing move. Slate-800 rather than the app's violet
     for the same reason the batch tabs use it: the active item here is a
     violet-tinted pill, so a violet ring would say the same thing twice and
     leave "where I am" indistinguishable from "what I am on".

     No sliding indicator, deliberately. That belongs to a bar whose items
     share a rail for a mark to travel along; these are separate filled pills
     with their own borders and elevation, several of them a route change
     apart, and a measured pill would have to chase both the route and the
     collapse animation to say what the fill already says. */
  const focus =
    'focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-800 focus-visible:ring-offset-2'

  if (isActive) {
    const activeBg = showLabels
      ? 'bg-gradient-to-r from-violet-100 to-white'
      : 'bg-violet-100/90'
    return `relative flex items-center ${layout} text-sm font-medium rounded-xl whitespace-nowrap group text-violet-800 ${activeBg} border border-violet-300 shadow-md -translate-y-0.5 transition-all ${focus}`
  }
  return `flex items-center ${layout} text-sm font-medium rounded-xl whitespace-nowrap group text-slate-600 hover:text-slate-900 hover:bg-gradient-to-r hover:from-white hover:via-violet-50/60 hover:to-white border border-transparent hover:border-slate-200 hover:shadow-sm hover:-translate-y-0.5 transition-all ${focus}`
}

interface NavItemsProps {
  showLabels: boolean
  onNavigate?: () => void
}

function NavItems({ showLabels, onNavigate }: NavItemsProps) {
  return (
    <>
      {NAV_ITEMS.map(({ to, label, icon: Icon, end }) => {
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
                      ? 'text-violet-700'
                      : 'text-slate-500 group-hover:text-violet-600'
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

function ProfileAvatarFallback() {
  return (
    <span className="inline-flex items-center justify-center w-9 h-9 rounded-full bg-gradient-to-tr from-violet-500 to-violet-700 text-white shadow-md shadow-violet-300/70">
      <User className="w-5 h-5" />
    </span>
  )
}

function ProfileAvatar({ photoURL }: { photoURL?: string | null }) {
  const [failed, setFailed] = useState(false)

  if (!photoURL || failed) {
    return <ProfileAvatarFallback />
  }

  return (
    <img
      src={photoURL}
      alt=""
      referrerPolicy="no-referrer"
      className="w-9 h-9 rounded-full object-cover border-2 border-white shadow-sm"
      onError={() => setFailed(true)}
    />
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
          className="rounded-full p-0.5 hover:ring-2 hover:ring-violet-200 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
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
    /* One of the few things left that still asks first. It is not destructive,
       so there is nothing to undo — but there is unsaved work behind it (a
       half-written composer, an open draft), and signing back in does not
       bring that back. */
    const ok = await confirm({
      title: 'Sign out of MILA?',
      body: 'Anything you have typed but not sent will be lost.',
      confirmLabel: 'Sign out',
    })
    if (!ok) return
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
        /* Strong glass (white/75, blur 28) — the DS variant for panels and modals. */
        className={`maia-glass-strong fixed inset-y-0 left-0 z-50 flex w-full max-w-xs flex-col pb-4 pt-5 rounded-r-2xl transition-transform duration-300 md:hidden ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
        aria-hidden={!mobileOpen}
      >
        <div className="absolute top-4 right-4 z-50">
          <button
            type="button"
            onClick={onMobileClose}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-white/90 hover:bg-violet-50 shadow transition"
            aria-label="Close menu"
          >
            <X className="h-6 w-6 text-slate-700" />
          </button>
        </div>

        <div className="flex flex-shrink-0 items-center px-6 pt-6 pb-4 pr-14">
          <MilaLogo height={46} />
        </div>

        <nav className="flex-1 space-y-2 px-5 pt-2 pb-4 overflow-y-auto">
          <NavItems showLabels onNavigate={onMobileClose} />
        </nav>

        {uid && (
          <div className="px-5 py-4 border-t border-slate-100">
            <StressWidget />
          </div>
        )}

        <div className="mt-auto px-5 py-4 border-t border-slate-100">
          <ProfileBlock collapsed={false} onSignOut={handleSignOut} />
        </div>
      </aside>

      <aside
        id="mainSidebar"
        /* Liquid glass, as the design system's own app shell builds it:
           .maia-glass for the surface, --shadow-sidebar for the cast shadow. */
        className={`maia-glass hidden md:flex flex-col h-screen sticky top-0 transition-all duration-300 ease-in-out flex-shrink-0 ${sidebarWidth}`}
        style={{ borderRight: '1px solid var(--border-academic)', boxShadow: 'var(--shadow-sidebar)' }}
      >
        <div className={`flex-shrink-0 pt-6 pb-5 ${collapsed ? 'px-2' : 'px-5'}`}>
          <div
            className={`flex min-w-0 ${
              collapsed ? 'flex-col items-center gap-3' : 'items-center justify-between gap-3'
            }`}
          >
            {/* Expanded: the horizontal lockup. Collapsed: the mark alone —
                the wordmark never enters icon-sized surfaces. */}
            <NavLink
              to="/chat"
              className={collapsed ? 'flex-shrink-0' : 'min-w-0 flex-1'}
              aria-label="MILA — home"
            >
              <MilaLogo variant={collapsed ? 'mark' : 'lockup'} height={collapsed ? 40 : 54} />
            </NavLink>
            <button
              type="button"
              onClick={onToggleCollapsed}
              className={`flex-shrink-0 p-2.5 rounded-xl hover:bg-violet-100 text-slate-500 border border-slate-200/80 transition-all active:scale-95 shadow-sm ${
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
          <NavItems showLabels={!collapsed} />
        </nav>

        {!collapsed && uid && (
          <div className="px-5 py-4 border-t border-slate-100 flex-shrink-0">
            <StressWidget />
          </div>
        )}

        <div className={`border-t border-slate-100 flex-shrink-0 overflow-visible ${collapsed ? 'px-2 py-5' : 'px-5 py-5'}`}>
          <ProfileBlock collapsed={collapsed} onSignOut={handleSignOut} />
        </div>
      </aside>
    </>
  )
}
