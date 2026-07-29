import React from 'react'

const CSS = `
.maia-modal__backdrop{position:fixed;inset:0;z-index:9999;background:rgba(30,58,138,.30);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);display:flex;align-items:center;justify-content:center;padding:16px;animation:maia-fade .16s ease-out}
@keyframes maia-fade{from{opacity:0}to{opacity:1}}
@keyframes maia-pop{from{opacity:0;transform:translateY(8px) scale(.98)}to{opacity:1;transform:none}}
.maia-modal{position:relative;background:var(--surface-glass-strong);backdrop-filter:blur(28px) saturate(1.7);-webkit-backdrop-filter:blur(28px) saturate(1.7);border:1px solid var(--border-glass);border-radius:var(--radius-3xl);box-shadow:var(--shadow-2xl);width:100%;max-height:90vh;display:flex;flex-direction:column;overflow:hidden;font-family:var(--font-sans);animation:maia-pop .2s cubic-bezier(.4,0,.2,1)}
.maia-modal--sm{max-width:420px}.maia-modal--md{max-width:560px}.maia-modal--lg{max-width:720px}
.maia-modal__head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:20px 24px;border-bottom:1px solid var(--border-academic);background:linear-gradient(90deg,var(--azure-50),rgba(255,255,255,.4))}
.maia-modal__title{font-size:18px;font-weight:700;color:var(--slate-900);margin:0}
.maia-modal__eyebrow{font-size:10px;letter-spacing:.16em;text-transform:uppercase;font-weight:700;color:var(--slate-500);margin:4px 0 0}
.maia-modal__x{border:0;background:transparent;cursor:pointer;color:var(--slate-400);padding:6px;border-radius:var(--radius-lg);display:inline-flex}
.maia-modal__x:hover{background:var(--slate-100);color:var(--slate-600)}
.maia-modal__body{padding:24px;overflow-y:auto;color:var(--text-body);font-size:14px;line-height:1.6}
.maia-modal__foot{padding:16px 24px;border-top:1px solid var(--border-academic);background:rgba(248,250,252,.6);display:flex;gap:12px;justify-content:flex-end}
`

function useStyles(id, css) {
  if (typeof document !== 'undefined' && !document.getElementById(id)) {
    const s = document.createElement('style'); s.id = id; s.textContent = css; document.head.appendChild(s)
  }
}

/**
 * Centered dialog with frosted backdrop, gradient header and footer action row.
 */
export function Modal({ open = true, onClose, title, eyebrow, size = 'md', footer = null, children }) {
  useStyles('maia-modal-css', CSS)
  if (!open) return null
  return (
    <div className="maia-modal__backdrop" onClick={onClose}>
      <div className={`maia-modal maia-modal--${size}`} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        {(title || eyebrow || onClose) && (
          <div className="maia-modal__head">
            <div style={{ minWidth: 0 }}>
              {title && <h3 className="maia-modal__title">{title}</h3>}
              {eyebrow && <p className="maia-modal__eyebrow">{eyebrow}</p>}
            </div>
            {onClose && (
              <button className="maia-modal__x" aria-label="Close" onClick={onClose}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
              </button>
            )}
          </div>
        )}
        <div className="maia-modal__body">{children}</div>
        {footer && <div className="maia-modal__foot">{footer}</div>}
      </div>
    </div>
  )
}
