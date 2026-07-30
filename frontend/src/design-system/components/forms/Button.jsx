import React from 'react'

/*
 * Flat, not moulded.
 *
 * The previous primary stacked three skeuomorphic cues that together read as a
 * dated 3D pill: a 180deg light-to-dark gradient (a lit dome), an
 * `inset 0 1px 0 rgba(255,255,255,.28)` bevel along the top edge, and a
 * `translateY(1px)` press that mimicked a physical key travelling down.
 *
 * All three are gone. The surface is one solid brand purple; depth comes only
 * from a soft shadow that grows on hover, and the press is `scale(0.97)` —
 * feedback that reads as the interface responding rather than as a moulded
 * object being depressed. The palette is unchanged: the same violet-600 the
 * gradient used to end on.
 *
 * Motion follows the house animation rules: named properties rather than
 * `all`, a strong ease-out so the press registers on the first frame, 140ms
 * for press feedback, and hover gated behind a fine pointer so a tap on touch
 * does not leave the button stuck in its hover state.
 */
const CSS = `
.maia-btn{--maia-btn-ease:cubic-bezier(0.23,1,0.32,1);display:inline-flex;align-items:center;justify-content:center;gap:8px;font-family:var(--font-sans);font-weight:600;letter-spacing:-0.006em;border-radius:var(--radius-md);cursor:pointer;border:1px solid transparent;transition:background-color 160ms var(--maia-btn-ease),border-color 160ms var(--maia-btn-ease),color 160ms var(--maia-btn-ease),box-shadow 160ms var(--maia-btn-ease),transform 140ms var(--maia-btn-ease);white-space:nowrap;text-decoration:none;box-sizing:border-box;-webkit-tap-highlight-color:transparent}
.maia-btn:focus-visible{outline:none;box-shadow:0 0 0 2px #fff,0 0 0 4px var(--focus-ring)}
.maia-btn:disabled,.maia-btn[aria-disabled=true]{opacity:.55;cursor:not-allowed;pointer-events:none}
.maia-btn:active{transform:scale(.97)}
.maia-btn--sm{padding:6px 14px;font-size:13px;min-height:34px}
.maia-btn--md{padding:10px 20px;font-size:14px;min-height:44px}
.maia-btn--lg{padding:14px 24px;font-size:15px;min-height:52px}
.maia-btn--primary{background-color:var(--violet-600);color:#fff;box-shadow:0 1px 2px rgba(42,30,82,.16)}
.maia-btn--secondary{background-color:rgba(255,255,255,.72);backdrop-filter:blur(12px) saturate(1.4);-webkit-backdrop-filter:blur(12px) saturate(1.4);color:var(--slate-700);border-color:var(--slate-300)}
.maia-btn--ghost{background-color:transparent;color:var(--slate-700)}
.maia-btn--danger{background-color:var(--red-600);color:#fff;box-shadow:0 1px 2px rgba(42,30,82,.16)}
@media (hover:hover) and (pointer:fine){
.maia-btn--primary:hover{background-color:var(--violet-700);box-shadow:0 4px 14px rgba(95,72,156,.28)}
.maia-btn--secondary:hover{background-color:rgba(255,255,255,.95);border-color:var(--slate-400)}
.maia-btn--ghost:hover{background-color:var(--slate-100);color:var(--slate-900)}
.maia-btn--danger:hover{background-color:var(--red-700);box-shadow:0 4px 14px rgba(190,40,40,.24)}
}
.maia-btn--block{width:100%}
.maia-btn__spin{width:16px;height:16px;animation:maia-spin 1.1s linear infinite;transform-origin:center}
.maia-btn__spin .th{stroke:currentColor}
.maia-btn__spin .bd{fill:currentColor}
@keyframes maia-spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion: reduce){.maia-btn__spin{animation:none}.maia-btn{transition:background-color 160ms,border-color 160ms,color 160ms}.maia-btn:active{transform:none}}
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
