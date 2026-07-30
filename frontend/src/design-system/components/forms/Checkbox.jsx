import React from 'react'

const CSS = `
.maia-check{display:inline-flex;align-items:flex-start;gap:8px;font-family:var(--font-sans);font-size:14px;color:var(--slate-700);cursor:pointer;user-select:none}
.maia-check input{accent-color:var(--azure-600);width:16px;height:16px;margin-top:2px;cursor:pointer;flex-shrink:0}
.maia-check input:focus-visible{outline:2px solid var(--focus-ring);outline-offset:2px}
.maia-check--disabled{opacity:.55;cursor:not-allowed}
.maia-switch{position:relative;display:inline-flex;align-items:center;gap:10px;font-family:var(--font-sans);font-size:14px;color:var(--slate-700);cursor:pointer;user-select:none}
.maia-switch__track{width:40px;height:22px;border-radius:9999px;background:var(--slate-300);position:relative;transition:background var(--transition-base);flex-shrink:0}
.maia-switch__thumb{position:absolute;top:2px;left:2px;width:18px;height:18px;border-radius:50%;background:#fff;box-shadow:var(--shadow-sm);transition:transform var(--transition-base)}
.maia-switch input{position:absolute;opacity:0;width:0;height:0}
.maia-switch input:checked + .maia-switch__track{background:var(--azure-600)}
.maia-switch input:checked + .maia-switch__track .maia-switch__thumb{transform:translateX(18px)}
.maia-switch input:focus-visible + .maia-switch__track{box-shadow:0 0 0 3px var(--focus-ring)}
`

function useStyles(id, css) {
  if (typeof document !== 'undefined' && !document.getElementById(id)) {
    const s = document.createElement('style'); s.id = id; s.textContent = css; document.head.appendChild(s)
  }
}

/** Checkbox with label — azure accent, matching form controls. */
export function Checkbox({ label, disabled = false, className = '', ...rest }) {
  useStyles('maia-check-css', CSS)
  return (
    <label className={['maia-check', disabled ? 'maia-check--disabled' : '', className].filter(Boolean).join(' ')}>
      <input type="checkbox" disabled={disabled} {...rest} />
      {label && <span>{label}</span>}
    </label>
  )
}

/** Toggle switch — for connector toggles and settings. */
export function Switch({ label, disabled = false, className = '', ...rest }) {
  useStyles('maia-check-css', CSS)
  return (
    <label className={['maia-switch', className].filter(Boolean).join(' ')} style={disabled ? { opacity: 0.55, cursor: 'not-allowed' } : undefined}>
      <input type="checkbox" disabled={disabled} {...rest} />
      <span className="maia-switch__track"><span className="maia-switch__thumb" /></span>
      {label && <span>{label}</span>}
    </label>
  )
}
