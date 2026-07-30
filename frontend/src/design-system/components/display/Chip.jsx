import React from 'react'

const CSS = `
.maia-chip{backdrop-filter:blur(12px) saturate(1.4);-webkit-backdrop-filter:blur(12px) saturate(1.4);display:inline-flex;align-items:center;gap:8px;font-family:var(--font-sans);font-size:14px;font-weight:500;border-radius:var(--radius-full);padding:6px 14px;border:1px solid var(--azure-200);background:rgba(255,255,255,.7);color:var(--slate-700);cursor:pointer;transition:background var(--transition-fast),border-color var(--transition-fast);box-sizing:border-box}
.maia-chip:hover{background:var(--azure-50)}
.maia-chip--active{background:var(--azure-50);border-color:var(--azure-300);color:var(--azure-800);font-weight:600}
.maia-chip--plain{border-color:var(--slate-200);background:#fff}
.maia-chip--plain:hover{background:var(--slate-50)}
.maia-chip__x{display:inline-flex;padding:2px;border-radius:50%;color:var(--slate-400)}
.maia-chip__x:hover{background:var(--slate-100);color:var(--slate-600)}
.maia-chip:disabled{opacity:.5;cursor:not-allowed}
`

function useStyles(id, css) {
  if (typeof document !== 'undefined' && !document.getElementById(id)) {
    const s = document.createElement('style'); s.id = id; s.textContent = css; document.head.appendChild(s)
  }
}

/**
 * Rounded pill control — batch/space selector, filters, suggestion tags.
 * Optional trailing caret and dismiss affordance.
 */
export function Chip({ active = false, plain = false, caret = false, onDismiss, children, className = '', ...rest }) {
  useStyles('maia-chip-css', CSS)
  const cls = ['maia-chip', active ? 'maia-chip--active' : '', plain ? 'maia-chip--plain' : '', className].filter(Boolean).join(' ')
  return (
    <button type="button" className={cls} {...rest}>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{children}</span>
      {onDismiss && (
        <span className="maia-chip__x" role="button" tabIndex={0}
          onClick={(e) => { e.stopPropagation(); onDismiss(e) }}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onDismiss(e) } }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
        </span>
      )}
      {caret && (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--slate-400)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"/></svg>
      )}
    </button>
  )
}
