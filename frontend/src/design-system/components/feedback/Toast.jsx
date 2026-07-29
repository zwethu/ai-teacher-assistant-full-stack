import React from 'react'

const CSS = `
.maia-toast{display:inline-flex;align-items:flex-start;gap:10px;font-family:var(--font-sans);font-size:14px;background:rgba(255,255,255,.82);backdrop-filter:blur(20px) saturate(1.5);-webkit-backdrop-filter:blur(20px) saturate(1.5);border:1px solid var(--border-glass);border-left-width:4px;border-radius:var(--radius-xl);box-shadow:var(--shadow-lg);padding:12px 16px;max-width:380px;color:var(--slate-700);animation:maia-toast-in .2s cubic-bezier(.4,0,.2,1)}
@keyframes maia-toast-in{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:none}}
.maia-toast--success{border-left-color:var(--emerald-500)}
.maia-toast--error{border-left-color:var(--red-500)}
.maia-toast--info{border-left-color:var(--sky-500)}
.maia-toast--warning{border-left-color:var(--amber-500)}
.maia-toast__icon{flex-shrink:0;margin-top:1px}
.maia-toast--success .maia-toast__icon{color:var(--emerald-600)}
.maia-toast--error .maia-toast__icon{color:var(--red-600)}
.maia-toast--info .maia-toast__icon{color:var(--sky-600)}
.maia-toast--warning .maia-toast__icon{color:var(--amber-600)}
.maia-toast__msg{font-weight:500;line-height:1.4}
.maia-toast__x{margin-left:6px;border:0;background:transparent;color:var(--slate-400);cursor:pointer;padding:2px;display:inline-flex}
.maia-toast__x:hover{color:var(--slate-600)}
`

function useStyles(id, css) {
  if (typeof document !== 'undefined' && !document.getElementById(id)) {
    const s = document.createElement('style'); s.id = id; s.textContent = css; document.head.appendChild(s)
  }
}

const ICONS = {
  success: <path d="M20 6 9 17l-5-5"/>,
  error: <><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6M9 9l6 6"/></>,
  info: <><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></>,
  warning: <><path d="m21.7 18-8-14a2 2 0 0 0-3.4 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3Z"/><path d="M12 9v4M12 17h.01"/></>,
}

/** Inline toast/notification with a colored accent edge and status icon. */
export function Toast({ type = 'info', message, onDismiss, children, className = '', ...rest }) {
  useStyles('maia-toast-css', CSS)
  return (
    <div className={['maia-toast', `maia-toast--${type}`, className].filter(Boolean).join(' ')} role="status" {...rest}>
      <svg className="maia-toast__icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{ICONS[type]}</svg>
      <span className="maia-toast__msg">{message || children}</span>
      {onDismiss && (
        <button className="maia-toast__x" aria-label="Dismiss" onClick={onDismiss}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
        </button>
      )}
    </div>
  )
}
