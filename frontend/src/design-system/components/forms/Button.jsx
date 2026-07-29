import React from 'react'

const CSS = `
.maia-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;font-family:var(--font-sans);font-weight:500;border-radius:var(--radius-md);cursor:pointer;border:1px solid transparent;transition:background var(--transition-fast),color var(--transition-fast),box-shadow var(--transition-fast),transform var(--transition-fast);white-space:nowrap;text-decoration:none;box-sizing:border-box}
.maia-btn:focus-visible{outline:none;box-shadow:0 0 0 2px #fff,0 0 0 4px var(--focus-ring)}
.maia-btn:disabled,.maia-btn[aria-disabled=true]{opacity:.6;cursor:not-allowed;pointer-events:none}
.maia-btn--sm{padding:6px 14px;font-size:13px;min-height:34px}
.maia-btn--md{padding:10px 20px;font-size:14px;min-height:44px}
.maia-btn--lg{padding:14px 24px;font-size:15px;min-height:52px}
.maia-btn--primary{background:linear-gradient(180deg,var(--azure-500),var(--azure-600));color:#fff;box-shadow:var(--shadow-sm),inset 0 1px 0 rgba(255,255,255,.28)}
.maia-btn--primary:hover{background:linear-gradient(180deg,var(--azure-600),var(--azure-700));box-shadow:var(--shadow-primary),inset 0 1px 0 rgba(255,255,255,.28)}
.maia-btn--primary:active{transform:translateY(1px)}
.maia-btn--secondary{background:rgba(255,255,255,.72);backdrop-filter:blur(12px) saturate(1.4);-webkit-backdrop-filter:blur(12px) saturate(1.4);color:var(--slate-700);border-color:var(--slate-300);box-shadow:var(--shadow-xs),inset 0 1px 0 rgba(255,255,255,.7)}
.maia-btn--secondary:hover{background:rgba(255,255,255,.92);border-color:var(--slate-400)}
.maia-btn--ghost{background:transparent;color:var(--slate-700)}
.maia-btn--ghost:hover{background:var(--slate-100);color:var(--slate-900)}
.maia-btn--danger{background:var(--red-600);color:#fff;box-shadow:var(--shadow-sm)}
.maia-btn--danger:hover{background:var(--red-700)}
.maia-btn--block{width:100%}
.maia-btn__spin{width:16px;height:16px;animation:maia-spin 1.1s linear infinite;transform-origin:center}
.maia-btn__spin .th{stroke:currentColor}
.maia-btn__spin .bd{fill:currentColor}
@keyframes maia-spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion: reduce){.maia-btn__spin{animation:none}}
`

function useStyles(id, css) {
  if (typeof document !== 'undefined' && !document.getElementById(id)) {
    const s = document.createElement('style')
    s.id = id
    s.textContent = css
    document.head.appendChild(s)
  }
}

/**
 * Primary CTA and its siblings, matching MILA's liquid purple button.
 */
export function Button({
  variant = 'primary',
  size = 'md',
  block = false,
  loading = false,
  disabled = false,
  leadingIcon = null,
  trailingIcon = null,
  children,
  className = '',
  ...rest
}) {
  useStyles('maia-btn-css', CSS)
  const cls = [
    'maia-btn',
    `maia-btn--${variant}`,
    `maia-btn--${size}`,
    block ? 'maia-btn--block' : '',
    className,
  ].filter(Boolean).join(' ')
  return (
    <button className={cls} disabled={disabled || loading} {...rest}>
      {loading ? (
        <svg className="maia-btn__spin" viewBox="0 0 96 96" aria-hidden="true">
          <circle className="th" cx="48" cy="48" r="30" fill="none" strokeWidth="7" />
          <circle className="bd" cx="77.9" cy="49.8" r="9" /><circle className="bd" cx="65.3" cy="72.5" r="9" />
          <circle className="bd" cx="39.6" cy="76.8" r="9" /><circle className="bd" cx="20.2" cy="59.4" r="9" />
          <circle className="bd" cx="21.8" cy="33.4" r="9" /><circle className="bd" cx="43.1" cy="18.4" r="9" />
          <circle cx="68.1" cy="25.7" r="9" fill="var(--gold-400,#fcc018)" />
        </svg>
      ) : leadingIcon}
      {children}
      {!loading && trailingIcon}
    </button>
  )
}
