import React from 'react'

const CSS = `
.maia-card{background:var(--surface-card);border:1px solid var(--border-subtle);border-radius:var(--radius-xl);box-shadow:var(--shadow-sm);font-family:var(--font-sans);color:var(--text-body);box-sizing:border-box}
.maia-card--pad{padding:20px}
.maia-card--pad-lg{padding:24px}
.maia-card--2xl{border-radius:var(--radius-2xl)}
.maia-card--interactive{transition:box-shadow var(--transition-base),transform var(--transition-base),border-color var(--transition-base);cursor:pointer}
.maia-card--interactive:hover{box-shadow:var(--shadow-md);transform:translateY(-2px);border-color:var(--slate-200)}
.maia-card--glass{background:var(--surface-glass);backdrop-filter:blur(24px) saturate(1.6);-webkit-backdrop-filter:blur(24px) saturate(1.6);border-color:var(--border-glass);box-shadow:var(--shadow-glass)}
.maia-card__head{display:flex;align-items:flex-start;gap:12px;margin-bottom:12px}
.maia-card__tile{width:36px;height:36px;border-radius:var(--radius-lg);background:var(--azure-50);color:var(--azure-600);border:1px solid var(--azure-100);display:flex;align-items:center;justify-content:center;flex-shrink:0}
.maia-card__title{font-size:16px;font-weight:600;color:var(--slate-900);margin:0;line-height:1.3}
.maia-card__meta{font-size:12px;color:var(--text-muted);margin:2px 0 0}
`

function useStyles(id, css) {
  if (typeof document !== 'undefined' && !document.getElementById(id)) {
    const s = document.createElement('style'); s.id = id; s.textContent = css; document.head.appendChild(s)
  }
}

/**
 * White rounded surface with soft shadow — the product's default container.
 * Optional header row with an icon tile, title and meta line.
 */
export function Card({
  padding = 'md',
  rounded = 'xl',
  interactive = false,
  glass = false,
  icon = null,
  title,
  meta,
  headerRight = null,
  children,
  className = '',
  ...rest
}) {
  useStyles('maia-card-css', CSS)
  const cls = [
    'maia-card',
    padding === 'md' ? 'maia-card--pad' : padding === 'lg' ? 'maia-card--pad-lg' : '',
    rounded === '2xl' ? 'maia-card--2xl' : '',
    interactive ? 'maia-card--interactive' : '',
    glass ? 'maia-card--glass' : '',
    className,
  ].filter(Boolean).join(' ')
  const hasHead = icon || title || meta || headerRight
  return (
    <div className={cls} {...rest}>
      {hasHead && (
        <div className="maia-card__head">
          {icon && <div className="maia-card__tile">{icon}</div>}
          <div style={{ minWidth: 0, flex: 1 }}>
            {title && <h3 className="maia-card__title">{title}</h3>}
            {meta && <p className="maia-card__meta">{meta}</p>}
          </div>
          {headerRight}
        </div>
      )}
      {children}
    </div>
  )
}
