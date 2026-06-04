import { useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import Sidebar from './Sidebar.jsx'
import Navbar, { getPageTitle } from './Navbar.jsx'

export default function AppLayout() {
  const location = useLocation()
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  const pageTitle = getPageTitle(location.pathname)

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
          <Navbar
            title={pageTitle}
            onOpenMobileMenu={() => setMobileMenuOpen(true)}
          />

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
