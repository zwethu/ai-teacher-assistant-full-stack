import type { StressLevel } from '../../services/wellnessService'

/**
 * How a band looks, in one place.
 *
 * The bar and the word are two halves of one signal, and they used to be
 * derived separately from the same score in two different files — which is
 * exactly how a meter ends up painted "high" next to the word "Low". The
 * server decides the band; these maps decide how it reads.
 */

/** The fill: one hue, four depths. Pale lilac at rest, near-black plum pinned. */
export const LEVEL_FILL: Record<StressLevel, string> = {
  low: 'linear-gradient(90deg, var(--stress-low-from), var(--stress-low-to))',
  medium: 'linear-gradient(90deg, var(--stress-medium-from), var(--stress-medium-to))',
  high: 'linear-gradient(90deg, var(--stress-high-from), var(--stress-high-to))',
  max: 'linear-gradient(90deg, var(--stress-max-from), var(--stress-max-to))',
}

/** The word: green → yellow → orange → red. The alarm lives here, not on the bar. */
export const LEVEL_TEXT: Record<StressLevel, string> = {
  low: 'text-emerald-600',
  medium: 'text-amber-600',
  high: 'text-orange-600',
  max: 'text-red-600',
}

export function levelWord(level: StressLevel): string {
  return { low: 'Low', medium: 'Medium', high: 'High', max: 'Max' }[level]
}
