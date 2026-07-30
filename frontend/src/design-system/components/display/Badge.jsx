import React from 'react'

const CSS = `
.maia-badge{display:inline-flex;align-items:center;gap:5px;font-family:var(--font-sans);font-weight:600;border-radius:var(--radius-full);border:1px solid transparent;white-space:nowrap;line-height:1}
.maia-badge--sm{font-size:11px;padding:3px 8px}
.maia-badge--md{font-size:12px;padding:5px 12px}
.maia-badge--neutral{background:var(--slate-100);color:var(--slate-600);border-color:var(--slate-200)}
.maia-badge--primary{background:var(--azure-50);color:var(--azure-700);border-color:var(--azure-200)}
.maia-badge--success{background:var(--emerald-50);color:var(--emerald-700);border-color:var(--emerald-200)}
.maia-badge--info{background:var(--sky-50);color:var(--sky-700);border-color:var(--sky-200)}
.maia-badge--warning{background:var(--amber-50);color:var(--amber-700);border-color:var(--amber-200)}
.maia-badge--danger{background:var(--red-50);color:var(--red-700);border-color:var(--red-200)}
.maia-badge__dot{width:6px;height:6px;border-radius:50%;background:currentColor}
`

function useStyles(id, css) {
  if (typeof document !== 'undefined' && !document.getElementById(id)) {
    const s = document.createElement('style'); s.id = id; s.textContent = css; document.head.appendChild(s)
  }
}

/**
 * Small status/label pill. Semantic tones map to the status palette.
 */
export function Badge({ tone = 'neutral', size = 'md', dot = false, icon = null, children, className = '', ...rest }) {
  useStyles('maia-badge-css', CSS)
  const cls = ['maia-badge', `maia-badge--${tone}`, `maia-badge--${size}`, className].filter(Boolean).join(' ')
  return (
    <span className={cls} {...rest}>
      {dot && <span className="maia-badge__dot" />}
      {icon}
      {children}
    </span>
  )
}
