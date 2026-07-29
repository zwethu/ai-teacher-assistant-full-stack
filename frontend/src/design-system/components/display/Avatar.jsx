import React from 'react'

const CSS = `
.maia-avatar{display:inline-flex;align-items:center;justify-content:center;border-radius:50%;overflow:hidden;font-family:var(--font-sans);font-weight:600;color:#fff;flex-shrink:0;box-sizing:border-box}
.maia-avatar img{width:100%;height:100%;object-fit:cover}
.maia-avatar--fallback{background:linear-gradient(135deg,var(--azure-500),var(--indigo-500));box-shadow:0 2px 8px rgba(37,99,235,.35)}
.maia-avatar--ring{border:2px solid #fff;box-shadow:var(--shadow-sm)}
`

function useStyles(id, css) {
  if (typeof document !== 'undefined' && !document.getElementById(id)) {
    const s = document.createElement('style'); s.id = id; s.textContent = css; document.head.appendChild(s)
  }
}

const SIZES = { sm: 28, md: 36, lg: 44 }

function initials(name) {
  if (!name) return ''
  const parts = name.trim().split(/\s+/)
  return (parts[0]?.[0] || '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')
}

/**
 * User avatar with photo, or an azure gradient fallback with initials.
 */
export function Avatar({ src, name, size = 'md', ring = false, className = '', ...rest }) {
  useStyles('maia-avatar-css', CSS)
  const px = SIZES[size] || size
  const fontSize = typeof px === 'number' ? Math.round(px * 0.4) : 14
  const cls = ['maia-avatar', !src ? 'maia-avatar--fallback' : '', ring ? 'maia-avatar--ring' : '', className].filter(Boolean).join(' ')
  return (
    <span className={cls} style={{ width: px, height: px, fontSize }} {...rest}>
      {src ? <img src={src} alt={name || ''} /> : (initials(name) || (
        <svg width={fontSize * 1.3} height={fontSize * 1.3} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
      ))}
    </span>
  )
}
