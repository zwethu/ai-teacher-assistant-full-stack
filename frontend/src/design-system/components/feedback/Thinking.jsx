import React from 'react'

/* MILA "thinking" animation — distinct from the loading spinner.
   The whole garland breathes (scale) and the thread takes a new form at every bead
   arrival — six shapes, morphing only while the gold bead travels — all threading
   every bead. All beads keep rippling continuously (1.2 s travelling wave locked to the walk, 0.2 s stagger)
   while the gold insight bead steps bead-to-bead (1.2 s a step), dimming the
   bead it settles on so it reads as each purple bead turning gold in turn. */
const CSS = `
.maia-think{display:inline-block;vertical-align:middle}
.maia-think .mt-all{animation:mt-breathe 7.2s ease-in-out infinite;transform-origin:48px 48px}
.maia-think .mt-ring{transition:d .5s cubic-bezier(.45,0,.4,1)}
.maia-think .mt-ripple{transform-box:fill-box;transform-origin:center;animation:mt-wave 1.2s cubic-bezier(.4,0,.5,1) infinite both}
.maia-think .mt-bead{animation:mt-hand 7.2s ease-in-out infinite both}
.maia-think .mt-orbit{animation:mt-step 7.2s cubic-bezier(.45,0,.4,1) infinite;transform-origin:48px 48px}
.maia-think .mt-gold{animation:mt-tap 1.2s cubic-bezier(.4,0,.4,1) infinite}
@keyframes mt-breathe{0%,100%{transform:scale(1)}50%{transform:scale(1.07)}}
@keyframes mt-pulse{0%,100%{stroke-width:5}50%{stroke-width:6.4}}
@keyframes mt-sweep{0%{stroke-dashoffset:0;opacity:.35}50%{opacity:.9}100%{stroke-dashoffset:-188.5;opacity:.35}}
@keyframes mt-wave{
  0%,100%{transform:translateX(0) scale(1,1)}
  30%{transform:translateX(4.5px) scale(.72,1.3)}
  55%{transform:translateX(-2.5px) scale(1.18,.84)}
  78%{transform:translateX(0) scale(1,1)}
}
@keyframes mt-hand{0%{opacity:1}3%{opacity:.28}9.4%{opacity:.15}15%{opacity:.75}20%,100%{opacity:1}}
@keyframes mt-step{
  0%,9.4%{transform:rotate(0deg)}
  16.67%,26.1%{transform:rotate(60deg)}
  33.33%,42.7%{transform:rotate(120deg)}
  50%,59.4%{transform:rotate(180deg)}
  66.67%,76.1%{transform:rotate(240deg)}
  83.33%,92.7%{transform:rotate(300deg)}
  100%{transform:rotate(360deg)}
}
@keyframes mt-tap{0%,50%{transform:scale(1.2)}78%{transform:scale(.8)}100%{transform:scale(1.2)}}
.maia-think-row{display:inline-flex;align-items:center;gap:10px;font-family:var(--font-sans);font-size:13.5px;color:var(--text-muted)}
.maia-think-row span{animation:mt-fade 7.2s ease-in-out infinite}
@keyframes mt-fade{0%,100%{opacity:.65}50%{opacity:1}}
@media (prefers-reduced-motion: reduce){
  .maia-think .mt-all,.maia-think .mt-ring,.maia-think .mt-ripple,.maia-think .mt-bead,.maia-think .mt-orbit,.maia-think .mt-gold,.maia-think-row span{animation:none;opacity:1}
}
`

function useStyles(id, css) {
  if (typeof document !== 'undefined' && !document.getElementById(id)) {
    const s = document.createElement('style'); s.id = id; s.textContent = css; document.head.appendChild(s)
  }
}

// 6 purple beads at their locked garland positions; the 7th (gold) orbits.
const FORMS = ["M 77.95 49.78 C 77.31 60.48, 71.01 70.03, 61.43 74.82 C 51.85 79.62, 40.43 78.94, 31.49 73.05 C 22.54 67.15, 17.42 56.92, 18.05 46.22 C 18.69 35.52, 24.99 25.97, 34.57 21.18 C 44.15 16.38, 55.57 17.06, 64.51 22.95 C 73.46 28.85, 78.58 39.08, 77.95 49.78 Z","M 77.95 49.78 C 77.95 49.78, 61.43 74.82, 61.43 74.82 C 61.43 74.82, 31.49 73.05, 31.49 73.05 C 31.49 73.05, 18.05 46.22, 18.05 46.22 C 18.05 46.22, 34.57 21.18, 34.57 21.18 C 34.57 21.18, 64.51 22.95, 64.51 22.95 C 64.51 22.95, 77.95 49.78, 77.95 49.78 Z","M 77.95 49.78 C 66.33 59.82, 66.09 60.19, 61.43 74.82 C 46.93 69.79, 46.49 69.76, 31.49 73.05 C 28.59 57.96, 28.40 57.57, 18.05 46.22 C 29.67 36.18, 29.91 35.81, 34.57 21.18 C 49.07 26.21, 49.51 26.24, 64.51 22.95 C 67.41 38.04, 67.60 38.43, 77.95 49.78 Z","M 77.95 49.78 C 90.29 61.25, 76.84 81.65, 61.43 74.82 C 57.67 91.25, 33.28 89.80, 31.49 73.05 C 15.38 78.00, 4.44 56.15, 18.05 46.22 C 5.71 34.75, 19.16 14.35, 34.57 21.18 C 38.33 4.75, 62.72 6.20, 64.51 22.95 C 80.62 18.00, 91.56 39.85, 77.95 49.78 Z","M 77.95 49.78 C 88.29 61.13, 66.09 60.19, 61.43 74.82 C 46.93 69.79, 34.38 88.13, 31.49 73.05 C 16.48 76.33, 28.40 57.57, 18.05 46.22 C 29.67 36.18, 20.06 16.14, 34.57 21.18 C 39.22 6.54, 49.51 26.24, 64.51 22.95 C 67.41 38.04, 89.56 39.73, 77.95 49.78 Z","M 77.95 49.78 C 77.89 50.78, 78.42 66.32, 61.43 74.82 C 44.44 83.33, 32.32 73.60, 31.49 73.05 C 30.65 72.49, 16.93 65.19, 18.05 46.22 C 19.18 27.25, 33.67 21.62, 34.57 21.18 C 35.46 20.73, 48.65 12.50, 64.51 22.95 C 80.38 33.41, 78.01 48.78, 77.95 49.78 Z"]

const RING = [
  { a: 3.4, fill: 'var(--violet-400,#9d80cb)' },
  { a: 63.4, fill: 'var(--violet-500,#7d5fb3)' },
  { a: 123.4, fill: 'var(--violet-600,#5f489c)' },
  { a: 183.4, fill: 'var(--violet-600,#5f489c)' },
  { a: 243.4, fill: 'var(--violet-500,#7d5fb3)' },
  { a: 303.4, fill: 'var(--violet-400,#9d80cb)' },
]

/** Agent-thinking indicator — use while the assistant is working.
 * (Use `Spinner` / `PageSpinner` for plain loading instead.) */
export function Thinking({ size = 40, className = '', style, ...rest }) {
  useStyles('maia-thinking-css', CSS)
  // the thread takes a NEW RANDOM form on every bead arrival (1.2 s a step)
  const [shape, setShape] = React.useState(FORMS[0])
  React.useEffect(() => {
    if (typeof window !== 'undefined' && window.matchMedia &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    let order = [], i = 0
    const reshuffle = () => {
      const last = order.length ? order[order.length - 1] : -1
      do {
        order = FORMS.map((_, k) => k)
        for (let k = order.length - 1; k > 0; k--) {
          const j = Math.floor(Math.random() * (k + 1))
          ;[order[k], order[j]] = [order[j], order[k]]
        }
      } while (order[0] === last)
    }
    reshuffle()
    const next = () => {
      if (i >= order.length) { reshuffle(); i = 0 }
      setShape(FORMS[order[i++]])
    }
    // fire as the gold bead LEAVES a bead (0.68 s into each 1.2 s step) so the
    // 0.5 s morph has settled before it arrives at the next one
    let id
    const kick = setTimeout(() => { next(); id = setInterval(next, 1200) }, 680)
    return () => { clearTimeout(kick); clearInterval(id) }
  }, [])
  return (
    <svg width={size} height={size} viewBox="0 0 96 96" role="status" aria-label="Thinking"
      className={['maia-think', className].filter(Boolean).join(' ')} style={style} {...rest}>
      <g className="mt-all">
      <path className="mt-ring" d={shape} fill="none" strokeLinecap="round"
          stroke="var(--violet-600,#5f489c)" strokeWidth="5" />
      {RING.map((b, i) => (
        <g key={i} transform={`rotate(${b.a} 48 48)`}>
          <g className="mt-ripple" style={{ animationDelay: `${i * 0.2}s` }}>
            <ellipse className="mt-bead" cx="78" cy="48" rx="7.5" ry="7.5" fill={b.fill}
              style={{ animationDelay: `${i * 1.2}s` }} />
          </g>
        </g>
      ))}
      <g className="mt-orbit">
        <circle className="mt-gold" cx="78" cy="48" r="7.5" fill="var(--gold-400,#fcc018)"
          style={{ transformBox: 'fill-box', transformOrigin: 'center' }} />
      </g>
      </g>
    </svg>
  )
}

/** Inline "MILA is thinking…" row for chat streams and agent runs. */
export function ThinkingRow({ label = 'Thinking…', size = 28 }) {
  useStyles('maia-thinking-css', CSS)
  return (
    <div className="maia-think-row">
      <Thinking size={size} />
      <span>{label}</span>
    </div>
  )
}
