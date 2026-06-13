import { useState } from 'react'
import { Menu } from 'lucide-react'
import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'

export default function AppLayout() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#E0F1FF] via-sky-50 to-[#CDE1FA] text-slate-800 font-sans">
      <div className="flex min-h-screen">
        <Sidebar
          collapsed={sidebarCollapsed}
          onToggleCollapsed={() => setSidebarCollapsed((c) => !c)}
          mobileOpen={mobileMenuOpen}
          onMobileClose={() => setMobileMenuOpen(false)}
        />

        <div className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
          <header className="md:hidden flex items-center px-5 py-4 sticky top-0 z-20 bg-white/80 backdrop-blur-xl border-b border-blue-200/60 flex-shrink-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="inline-flex items-center justify-center p-2.5 rounded-xl text-slate-600 hover:bg-blue-50 border border-slate-200/80"
              aria-label="Open menu"
            >
              <Menu className="h-6 w-6" />
            </button>
          </header>

          <main className="relative flex-1 overflow-y-auto focus:outline-none p-4 md:p-8">
            <div className="max-w-7xl mx-auto">
              <Outlet />
            </div>
          </main>
        </div>
      </div>
    </div>
  )
}
