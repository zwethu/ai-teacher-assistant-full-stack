// Per-surface accent tokens for the standalone generation workflow chrome
// (stepper, refine controls, spinners). The generated-artifact cards keep their
// own emerald content styling; only the workflow chrome adopts the page accent
// so each standalone surface stays aligned with its own theme.

export type GenAccent = 'emerald' | 'indigo'

export type AccentTokens = {
  text: string
  solid: string
  softBg: string
  softBorder: string
  ring: string
  dot: string
}

export const ACCENT: Record<GenAccent, AccentTokens> = {
  emerald: {
    text: 'text-emerald-700',
    solid: 'bg-emerald-600 hover:bg-emerald-700',
    softBg: 'bg-emerald-50',
    softBorder: 'border-emerald-200',
    ring: 'ring-emerald-500/40',
    dot: 'bg-emerald-500',
  },
  indigo: {
    text: 'text-indigo-700',
    solid: 'bg-indigo-600 hover:bg-indigo-700',
    softBg: 'bg-indigo-50',
    softBorder: 'border-indigo-200',
    ring: 'ring-indigo-500/40',
    dot: 'bg-indigo-500',
  },
}
