import type { MoodOption, MoodStyle, MoodValue } from '../types'

export const MOOD_OPTIONS: MoodOption[] = [
  { value: 'great', label: 'Great', emoji: '😊' },
  { value: 'okay', label: 'Okay', emoji: '🙂' },
  { value: 'tired', label: 'Tired', emoji: '😴' },
  { value: 'stressed', label: 'Stressed', emoji: '😟' },
  { value: 'overwhelmed', label: 'Overwhelmed', emoji: '😰' },
  { value: 'not_selected', label: 'Not specified', emoji: '📝' },
]

export const MOOD_SELECT_OPTIONS = MOOD_OPTIONS.filter(
  (m) => m.value !== 'not_selected',
)

export function getMoodOption(value: string): MoodOption {
  return (
    MOOD_OPTIONS.find((m) => m.value === value) ||
    MOOD_OPTIONS.find((m) => m.value === 'not_selected')!
  )
}

export const MOOD_STYLES: Record<MoodValue, MoodStyle> = {
  great: {
    pill: 'bg-violet-50 text-violet-700 border-violet-200',
    text: 'text-violet-600',
    card: 'border-violet-200 bg-violet-50/40',
  },
  okay: {
    pill: 'bg-sky-50 text-sky-700 border-sky-200',
    text: 'text-sky-600',
    card: 'border-sky-200 bg-sky-50/40',
  },
  tired: {
    pill: 'bg-amber-50 text-amber-700 border-amber-200',
    text: 'text-amber-600',
    card: 'border-amber-200 bg-amber-50/40',
  },
  stressed: {
    pill: 'bg-orange-50 text-orange-700 border-orange-200',
    text: 'text-orange-600',
    card: 'border-orange-200 bg-orange-50/40',
  },
  overwhelmed: {
    pill: 'bg-red-50 text-red-700 border-red-200',
    text: 'text-red-600',
    card: 'border-red-200 bg-red-50/40',
  },
  not_selected: {
    pill: 'bg-slate-50 text-slate-600 border-slate-200',
    text: 'text-slate-500',
    card: 'border-slate-200 bg-slate-50/40',
  },
}

export function getMoodStyle(value: string): MoodStyle {
  return MOOD_STYLES[value as MoodValue] || MOOD_STYLES.not_selected
}
