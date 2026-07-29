/**
 * MILA logo.
 *
 * Renders the production SVGs from `public/brand/` as-is — the brand spec is
 * explicit that the mark is never redrawn and the wordmark never retyped, so
 * this deliberately does not inline any geometry.
 *
 * `lockup`  — mark + golden-pillar MILA caps (140×84 viewBox). Primary use.
 * `mark`    — the beads-loop ring alone (96×96). For collapsed rails and icons.
 *
 * Clear space is 1 bead diameter on all sides (15/84 of the lockup's height);
 * `clearSpace` applies it as padding so the logo can sit flush against other
 * chrome without violating the rule.
 */

type Props = {
  variant?: 'lockup' | 'mark'
  /** Rendered height in px. Width follows the artwork's aspect ratio. */
  height?: number
  /** Knockout version, for violet/ink backgrounds. */
  white?: boolean
  /** Pad by one bead diameter, per the brand's clear-space rule. */
  clearSpace?: boolean
  className?: string
}

const SRC = {
  lockup: { color: '/brand/mila-lockup-horizontal.svg', white: '/brand/mila-lockup-horizontal-white.svg', ratio: 140 / 84 },
  mark: { color: '/brand/mila-mark.svg', white: '/brand/mila-mark-white.svg', ratio: 1 },
} as const

export function MilaLogo({
  variant = 'lockup',
  height = 34,
  white = false,
  clearSpace = false,
  className = '',
}: Props) {
  const art = SRC[variant]
  // 1 bead Ø = 15 units; the lockup is 84 units tall, the mark 96.
  const bead = height * (15 / (variant === 'lockup' ? 84 : 96))

  return (
    <img
      src={white ? art.white : art.color}
      alt="MILA"
      height={height}
      width={Math.round(height * art.ratio)}
      style={{ height, width: height * art.ratio, padding: clearSpace ? bead : undefined }}
      className={`select-none ${className}`}
      draggable={false}
    />
  )
}
