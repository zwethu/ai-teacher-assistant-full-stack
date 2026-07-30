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

          <main className="relative flex-1 flex flex-col min-h-0 overflow-hidden focus:outline-none px-4 pt-4 pb-4 md:px-8 md:pt-6 md:pb-6">
            <div className="max-w-7xl mx-auto w-full flex-1 flex flex-col min-h-0 overflow-y-auto">
              <Outlet />
            </div>
          </main>
        </div>
      </div>
    </div>
  )
}
