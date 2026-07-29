import React from 'react'

const CSS = `
@keyframes maia-spin{to{transform:rotate(360deg)}}
.maia-spinner{display:inline-block;vertical-align:middle;animation:maia-spin 1.1s linear infinite;transform-origin:center}
.maia-pagespinner{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:48px;font-family:var(--font-sans);color:var(--text-muted);font-size:14px}
.maia-beadspin .maia-bs-thread{stroke-dasharray:189;stroke-dashoffset:189;animation:maia-bs-draw 3.2s ease-in-out infinite}
.maia-beadspin .maia-bs-bead{transform-box:fill-box;transform-origin:center;animation:maia-bs-pop 3.2s cubic-bezier(.34,1.4,.64,1) infinite both}
@keyframes maia-bs-draw{0%{stroke-dashoffset:189;opacity:1}32%{stroke-dashoffset:0}88%{stroke-dashoffset:0;opacity:1}97%,100%{stroke-dashoffset:0;opacity:0}}
@keyframes maia-bs-pop{0%,8%{transform:scale(0);opacity:0}16%{transform:scale(1);opacity:1}86%{transform:scale(1);opacity:1}95%,100%{transform:scale(0);opacity:0}}
@media (prefers-reduced-motion: reduce){
  .maia-spinner{animation:none}
  .maia-beadspin .maia-bs-thread,.maia-beadspin .maia-bs-bead{animation:none;opacity:1;stroke-dashoffset:0;transform:none}
}
`

function useStyles(id, css) {
  if (typeof document !== 'undefined' && !document.getElementById(id)) {
    const s = document.createElement('style'); s.id = id; s.textContent = css; document.head.appendChild(s)
  }
}

// MILA bead-loop geometry (96 grid): 7 beads Ø15 on a Ø60 thread, gold at 1–2 o'clock.
const BEADS = [
  [77.9, 49.8, 'var(--violet-400,#9d80cb)'],
  [65.3, 72.5, 'var(--violet-500,#7d5fb3)'],
  [39.6, 76.8, 'var(--violet-600,#5f489c)'],
  [20.2, 59.4, 'var(--violet-600,#5f489c)'],
  [21.8, 33.4, 'var(--violet-500,#7d5fb3)'],
  [43.1, 18.4, 'var(--violet-400,#9d80cb)'],
]
const GOLD = [68.1, 25.7, 'var(--gold-400,#fcc018)']

function BeadRing({ size, tone, animate, delayBase = 0.2, className = '', style, ...rest }) {
  const muted = tone === 'muted'
  const inverse = tone === 'inverse'
  const stroke = inverse ? 'currentColor' : muted ? 'var(--slate-300)' : 'var(--violet-600,#5f489c)'
  return (
    <svg width={size} height={size} viewBox="0 0 96 96" role="status" aria-label="Loading"
      className={[animate ? 'maia-beadspin' : 'maia-spinner', className].filter(Boolean).join(' ')} style={style} {...rest}>
      <circle className={animate ? 'maia-bs-thread' : undefined} cx="48" cy="48" r="30" fill="none"
        stroke={stroke} strokeWidth="5" transform="rotate(-48 48 48)" />
      {BEADS.map(([cx, cy, fill], i) => (
        <circle key={i} className={animate ? 'maia-bs-bead' : undefined} cx={cx} cy={cy} r="7.5"
          fill={inverse ? 'currentColor' : muted ? 'var(--slate-300)' : fill} style={animate ? { animationDelay: `${delayBase + i * 0.18}s` } : undefined} />
      ))}
      <circle className={animate ? 'maia-bs-bead' : undefined} cx={GOLD[0]} cy={GOLD[1]} r="7.5"
        fill={muted ? 'var(--slate-400)' : GOLD[2]} style={animate ? { animationDelay: `${delayBase + 1.25}s` } : undefined} />
    </svg>
  )
}

/** Brand loader — the MILA bead loop playing its designed animation.
 *
 * The system ships two motions, and only one of them is the real spinner:
 *   .maia-beadspin — the designed loader: the thread draws itself, the six
 *                    purple beads pop on in order and the gold insight bead
 *                    lands last (3.2s).
 *   .maia-spinner  — a plain 1.1s rotation of the whole mark. Upstream falls
 *                    back to this below 28px, where the bead sequence would be
 *                    too small to read.
 *
 * That size threshold means a 44px page loader and a 16px inline one animate
 * differently, and the small one reads as "the logo is spinning" rather than as
 * the brand's loader. Every loading state here plays the designed bead
 * animation instead, at any size, so loading looks like one thing throughout.
 *
 * `tone`:
 *   'brand'   (default) violet thread + violet beads, gold insight bead
 *   'muted'   slate, for low-emphasis surfaces
 *   'inverse' thread + beads inherit `currentColor`, gold insight bead holds —
 *             for solid violet/danger buttons where a violet garland would be
 *             invisible. This mirrors what the DS Button's own loading spinner
 *             already does (`.maia-btn__spin .th{stroke:currentColor}`), so it
 *             is the system's established pattern rather than a new invention.
 *
 * `muted` is kept as a deprecated alias for `tone="muted"`.
 */
export function Spinner({ size = 20, muted = false, tone, className = '', style, ...rest }) {
  useStyles('maia-spinner-css', CSS)
  const resolved = tone || (muted ? 'muted' : 'brand')
  return <BeadRing size={size} tone={resolved} animate className={className} style={style} {...rest} />
}

/** Full-panel loading state with a label below the bead-loop loader. */
export function PageSpinner({ label = 'Loading…' }) {
  useStyles('maia-spinner-css', CSS)
  return (
    <div className="maia-pagespinner">
      <Spinner size={44} />
      <span>{label}</span>
    </div>
  )
}
