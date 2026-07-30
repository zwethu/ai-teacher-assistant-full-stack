// Accent tokens for the standalone generation workflow chrome (stepper, refine
// controls, spinners).
//
// MILA has a single functional primary — MLII royal purple — so this collapsed
// from the pre-MILA `emerald | indigo` pair to one accent. The old `indigo`
// variant had no call sites, and MILA aliases indigo into the purple ramp
// regardless, so both would now render identically.

export type GenAccent = 'primary'

export type AccentTokens = {
  text: string
  solid: string
  softBg: string
  softBorder: string
  ring: string
  dot: string
}

export const ACCENT: Record<GenAccent, AccentTokens> = {
  primary: {
    text: 'text-violet-700',
    solid: 'bg-violet-600 hover:bg-violet-700',
    softBg: 'bg-violet-50',
    softBorder: 'border-violet-200',
    ring: 'ring-violet-500/40',
    dot: 'bg-violet-500',
  },
}
