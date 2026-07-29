import React from 'react'

const CSS = `
.maia-nav{display:flex;align-items:center;gap:12px;padding:10px 12px;border-radius:var(--radius-xl);font-family:var(--font-sans);font-size:14px;font-weight:500;color:var(--slate-600);border:1px solid transparent;cursor:pointer;text-decoration:none;white-space:nowrap;transition:all var(--transition-base);background:transparent;width:100%;box-sizing:border-box}
.maia-nav:hover{color:var(--slate-900);background:linear-gradient(90deg,#fff,rgba(239,246,255,.6),#fff);border-color:var(--slate-200);box-shadow:var(--shadow-xs);transform:translateY(-2px)}
.maia-nav__icon{width:20px;height:20px;flex-shrink:0;color:var(--slate-500);transition:color var(--transition-base)}
.maia-nav:hover .maia-nav__icon{color:var(--azure-600)}
.maia-nav--active{color:var(--azure-800);background:linear-gradient(90deg,var(--azure-100),#fff);border-color:var(--azure-300);box-shadow:var(--shadow-md);transform:translateY(-2px)}
.maia-nav--active .maia-nav__icon{color:var(--azure-700)}
.maia-nav--collapsed{width:40px;height:40px;padding:0;justify-content:center;margin:0 auto}
.maia-nav__badge{margin-left:auto;font-size:11px;font-weight:600;background:var(--azure-100);color:var(--azure-700);border-radius:9999px;padding:1px 8px}
`

function useStyles(id, css) {
  if (typeof document !== 'undefined' && !document.getElementById(id)) {
    const s = document.createElement('style'); s.id = id; s.textContent = css; document.head.appendChild(s)
  }
}

/**
 * Sidebar navigation item — lifted active/hover states with an azure gradient.
 * Render as a link (pass `href`) or a button. `icon` takes a Lucide-style node.
 */
export function NavItem({ icon, label, active = false, collapsed = false, badge, href, className = '', ...rest }) {
  useStyles('maia-nav-css', CSS)
  const cls = ['maia-nav', active ? 'maia-nav--active' : '', collapsed ? 'maia-nav--collapsed' : '', className].filter(Boolean).join(' ')
  const inner = (
    <>
      {icon && <span className="maia-nav__icon" aria-hidden="true">{icon}</span>}
      {!collapsed && <span>{label}</span>}
      {!collapsed && badge != null && <span className="maia-nav__badge">{badge}</span>}
    </>
  )
  const Tag = href ? 'a' : 'button'
  return <Tag className={cls} href={href} title={collapsed ? label : undefined} aria-current={active ? 'page' : undefined} {...rest}>{inner}</Tag>
}
