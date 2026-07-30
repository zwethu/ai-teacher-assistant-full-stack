import React from 'react'

const CSS = `
.maia-iconbtn{display:inline-flex;align-items:center;justify-content:center;border-radius:var(--radius-full);cursor:pointer;border:1px solid transparent;background:transparent;color:var(--slate-500);transition:background var(--transition-fast),color var(--transition-fast),transform var(--transition-fast);box-sizing:border-box}
.maia-iconbtn:hover{background:rgba(255,255,255,.8);color:var(--slate-800)}
.maia-iconbtn:active{transform:scale(.95)}
.maia-iconbtn:focus-visible{outline:none;box-shadow:0 0 0 2px var(--focus-ring)}
.maia-iconbtn:disabled{opacity:.5;cursor:not-allowed}
.maia-iconbtn--sm{width:32px;height:32px}
.maia-iconbtn--md{width:36px;height:36px}
.maia-iconbtn--lg{width:44px;height:44px}
.maia-iconbtn--solid{background:var(--azure-600);color:#fff}
.maia-iconbtn--solid:hover{background:var(--azure-700);color:#fff}
.maia-iconbtn--soft{background:var(--azure-50);color:var(--azure-600);border-color:var(--azure-100)}
.maia-iconbtn--soft:hover{background:var(--azure-100)}
.maia-iconbtn--danger:hover{background:var(--red-50);color:var(--red-600)}
.maia-iconbtn--tile{border-radius:var(--radius-xl);border-color:var(--slate-200)}
`

function useStyles(id, css) {
  if (typeof document !== 'undefined' && !document.getElementById(id)) {
    const s = document.createElement('style'); s.id = id; s.textContent = css; document.head.appendChild(s)
  }
}

/**
 * Square/round icon-only button — toolbar actions, close buttons, panel toggles.
 */
export function IconButton({ variant = 'ghost', size = 'md', tile = false, label, children, className = '', ...rest }) {
  useStyles('maia-iconbtn-css', CSS)
  const cls = ['maia-iconbtn', `maia-iconbtn--${variant}`, `maia-iconbtn--${size}`, tile ? 'maia-iconbtn--tile' : '', className].filter(Boolean).join(' ')
  return <button className={cls} aria-label={label} title={label} {...rest}>{children}</button>
}
