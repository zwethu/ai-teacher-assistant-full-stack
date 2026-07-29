import React from 'react'

const CSS = `
.maia-progress{width:100%;height:8px;border-radius:9999px;background:var(--slate-100);overflow:hidden}
.maia-progress--lg{height:12px}
.maia-progress__fill{height:100%;border-radius:9999px;transition:width .7s cubic-bezier(.4,0,.2,1);background:var(--azure-500)}
.maia-progress__fill--info{background:var(--sky-400)}
.maia-progress__fill--success{background:var(--emerald-500)}
.maia-progress__fill--warning{background:var(--orange-500)}
.maia-progress__fill--danger{background:var(--red-500)}
.maia-progress__fill--grad{background:linear-gradient(90deg,var(--cyan-400),var(--azure-500))}
`

function useStyles(id, css) {
  if (typeof document !== 'undefined' && !document.getElementById(id)) {
    const s = document.createElement('style'); s.id = id; s.textContent = css; document.head.appendChild(s)
  }
}

/**
 * Thin rounded progress/level bar. Powers the sidebar stress meter and the
 * wellness mood-summary bars; `tone="auto"` derives color from the value.
 */
export function ProgressBar({ value = 0, max = 100, tone = 'primary', size = 'md', className = '', ...rest }) {
  useStyles('maia-progress-css', CSS)
  const pct = Math.max(0, Math.min(100, (value / max) * 100))
  let t = tone
  if (tone === 'auto') t = pct >= 100 ? 'danger' : pct >= 80 ? 'warning' : 'success'
  const fillMod = t === 'info' ? 'maia-progress__fill--info'
    : t === 'success' ? 'maia-progress__fill--success'
    : t === 'warning' ? 'maia-progress__fill--warning'
    : t === 'danger' ? 'maia-progress__fill--danger'
    : t === 'gradient' ? 'maia-progress__fill--grad' : ''
  return (
    <div className={['maia-progress', size === 'lg' ? 'maia-progress--lg' : '', className].filter(Boolean).join(' ')}
      role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={max} {...rest}>
      <div className={['maia-progress__fill', fillMod].filter(Boolean).join(' ')} style={{ width: `${pct}%` }} />
    </div>
  )
}
