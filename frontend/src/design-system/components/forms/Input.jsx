import React from 'react'

const CSS = `
.maia-field{display:flex;flex-direction:column;gap:6px;font-family:var(--font-sans)}
.maia-field__label{font-size:14px;font-weight:600;color:var(--slate-700)}
.maia-field__req{color:var(--red-500);margin-left:2px}
.maia-field__hint{font-size:12px;color:var(--text-muted)}
.maia-field__err{font-size:12px;color:var(--red-600);font-weight:500}
.maia-control{display:block;width:100%;box-sizing:border-box;font-family:var(--font-sans);font-size:14px;color:var(--slate-800);background:#fff;border:1px solid var(--slate-300);border-radius:var(--radius-md);padding:10px 12px;transition:border-color var(--transition-fast),box-shadow var(--transition-fast),background var(--transition-fast)}
.maia-control::placeholder{color:var(--slate-400)}
.maia-control:hover{border-color:var(--slate-400)}
.maia-control:focus{outline:none;border-color:var(--azure-500);box-shadow:0 0 0 3px var(--focus-ring)}
.maia-control:disabled{background:var(--slate-50);opacity:.7;cursor:not-allowed}
.maia-control--soft{border-color:var(--azure-200);background:var(--slate-50)}
.maia-control--soft:focus{background:#fff}
.maia-control--invalid{border-color:var(--red-400,#f87171)}
.maia-control--invalid:focus{border-color:var(--red-500);box-shadow:0 0 0 3px rgba(239,68,68,.25)}
textarea.maia-control{resize:vertical;min-height:80px;line-height:1.5}
.maia-select-wrap{position:relative}
.maia-select-wrap svg,.maia-select-wrap .maia-caret{position:absolute;right:12px;top:50%;transform:translateY(-50%);pointer-events:none;color:var(--slate-400)}
select.maia-control{appearance:none;padding-right:36px;cursor:pointer}
`

function useStyles(id, css) {
  if (typeof document !== 'undefined' && !document.getElementById(id)) {
    const s = document.createElement('style'); s.id = id; s.textContent = css; document.head.appendChild(s)
  }
}

function Field({ label, htmlFor, required, hint, error, children }) {
  return (
    <div className="maia-field">
      {label && <label className="maia-field__label" htmlFor={htmlFor}>{label}{required && <span className="maia-field__req">*</span>}</label>}
      {children}
      {error ? <span className="maia-field__err">{error}</span> : hint ? <span className="maia-field__hint">{hint}</span> : null}
    </div>
  )
}

/** Single-line text field with MILA's purple focus ring. */
export function Input({ label, hint, error, required, soft = false, id, className = '', ...rest }) {
  useStyles('maia-control-css', CSS)
  const cls = ['maia-control', soft ? 'maia-control--soft' : '', error ? 'maia-control--invalid' : '', className].filter(Boolean).join(' ')
  const input = <input id={id} className={cls} {...rest} />
  if (!label && !hint && !error) return input
  return <Field label={label} htmlFor={id} required={required} hint={hint} error={error}>{input}</Field>
}

/** Multi-line text area (composer, notes, instructions). */
export function Textarea({ label, hint, error, required, soft = false, id, rows = 3, className = '', ...rest }) {
  useStyles('maia-control-css', CSS)
  const cls = ['maia-control', soft ? 'maia-control--soft' : '', error ? 'maia-control--invalid' : '', className].filter(Boolean).join(' ')
  const el = <textarea id={id} rows={rows} className={cls} {...rest} />
  if (!label && !hint && !error) return el
  return <Field label={label} htmlFor={id} required={required} hint={hint} error={error}>{el}</Field>
}

/** Native select styled to match, with a chevron affordance. */
export function Select({ label, hint, error, required, soft = false, id, children, className = '', ...rest }) {
  useStyles('maia-control-css', CSS)
  const cls = ['maia-control', soft ? 'maia-control--soft' : '', error ? 'maia-control--invalid' : '', className].filter(Boolean).join(' ')
  const el = (
    <div className="maia-select-wrap">
      <select id={id} className={cls} {...rest}>{children}</select>
      <svg className="maia-caret" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"/></svg>
    </div>
  )
  if (!label && !hint && !error) return el
  return <Field label={label} htmlFor={id} required={required} hint={hint} error={error}>{el}</Field>
}
