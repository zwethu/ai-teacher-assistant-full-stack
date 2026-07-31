import { useState } from 'react'
import { Menu } from 'lucide-react'
import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'

export default function AppLayout() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  return (
    <div className="maia-app-bg h-screen overflow-hidden text-slate-800 font-sans">
      <div className="flex h-full">
        <Sidebar
          collapsed={sidebarCollapsed}
          onToggleCollapsed={() => setSidebarCollapsed((c) => !c)}
          mobileOpen={mobileMenuOpen}
          onMobileClose={() => setMobileMenuOpen(false)}
        />

        <div className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
          <header className="maia-glass-header md:hidden flex items-center px-5 py-4 sticky top-0 z-20 flex-shrink-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="inline-flex items-center justify-center p-2.5 rounded-xl text-slate-600 hover:bg-[var(--violet-50)] border border-slate-200/80"
              aria-label="Open menu"
            >
              <Menu className="h-6 w-6" />
            </button>
          </header>

          {/* The scroller is horizontally full-bleed so its scrollbar sits flush
              against the window edge instead of being stranded in a strip of
              background. The bottom gap stays outside the scroller so it is a
              permanent frame: as padding on the scrolling content it would only
              appear once you reach the end, leaving rows flush against the
              window edge for the whole scroll. */}
          <main className="relative flex-1 flex flex-col min-h-0 overflow-hidden focus:outline-none pb-4 md:pb-6">
            <div className="flex-1 flex flex-col min-h-0 overflow-y-auto">
              <div className="max-w-7xl mx-auto w-full flex-1 flex flex-col min-h-0 px-4 pt-4 md:px-8 md:pt-6">
                <Outlet />
              </div>
            </div>
          </main>
        </div>
      </div>
    </div>
  )
}
