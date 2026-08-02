import { useId, type ReactNode } from 'react'

import { FIELD_CLASS, FIELD_INVALID_CLASS, FIELD_LABEL_CLASS } from './fieldStyles'

/**
 * A number field whose stepper belongs to us.
 *
 * `<input type="number">` draws its spinner with the operating system, which
 * is the same problem the native `<select>` had: on Windows it is a grey
 * two-tone box, on macOS a pair of tiny blue triangles, and on neither does it
 * know the field beside it is violet. It also only appears on hover in Chrome,
 * so half the time the field looks like a plain text box that mysteriously
 * rejects letters.
 *
 * So the native spinner is switched off and two triangles are drawn in its
 * place, in the brand's own colours, always visible — the same stacked pair
 * the platform draws, because that shape is what a number field's stepper *is*
 * to anyone who has used one. Lucide's chevrons were the first attempt and
 * read as navigation: an outlined arrowhead is the mark for "go somewhere", a
 * solid triangle the mark for "nudge this value".
 *
 * Typing stays the primary path — the steppers are for a nudge, which is what
 * "next week" usually is. They are about 20px tall each, under the 44px a
 * touch target wants; that is a deliberate trade for a control that has to fit
 * inside a 42px field, and nothing here is reachable *only* by tapping them.
 */

/**
 * One half of the stepper.
 *
 * Drawn rather than taken from the icon set: the shape wanted here is a small
 * solid triangle, and an icon library's triangle is an outlined equilateral
 * one at a size meant for a 24px grid. Two paths are cheaper than fighting it.
 */
function StepArrow({ direction }: { direction: 'up' | 'down' }) {
  return (
    <svg
      viewBox="0 0 10 6"
      className="h-[6px] w-[10px] fill-current"
      aria-hidden="true"
      style={direction === 'down' ? { transform: 'rotate(180deg)' } : undefined}
    >
      <path d="M5 0 10 6 0 6z" />
    </svg>
  )
}

export type NumberFieldProps = {
  value: number
  onChange: (value: number) => void
  label?: ReactNode
  min?: number
  max?: number
  step?: number
  required?: boolean
  disabled?: boolean
  /** Fails the caller's own validation — swaps the field's resting border. */
  invalid?: boolean
  id?: string
  className?: string
  /** Id of the hint or error this field is described by. */
  describedBy?: string
  'aria-label'?: string
}

export function NumberField({
  value,
  onChange,
  label,
  min,
  max,
  step = 1,
  required,
  disabled,
  invalid = false,
  id,
  className = '',
  describedBy,
  'aria-label': ariaLabel,
}: NumberFieldProps) {
  const generatedId = useId()
  const fieldId = id ?? `number-${generatedId}`

  const clamp = (next: number) => {
    if (min !== undefined && next < min) return min
    if (max !== undefined && next > max) return max
    return next
  }

  const nudge = (direction: 1 | -1) => {
    if (disabled) return
    // From the floor, not from NaN: a field cleared to empty parses to NaN, and
    // stepping up from that used to produce NaN rather than the first legal
    // value.
    const base = Number.isFinite(value) ? value : min ?? 0
    onChange(clamp(base + direction * step))
  }

  const atMin = min !== undefined && Number.isFinite(value) && value <= min
  const atMax = max !== undefined && Number.isFinite(value) && value >= max

  /* Each half of the field's height is a hit target, but the two glyphs sit
     against the middle rather than centred in their own halves — so they read
     as one stacked pair, the way the platform's own spinner does, instead of
     two arrows at opposite ends of the box with a gap between them. The button
     stays full-height; only the triangle moves. */
  const stepper =
    'flex h-1/2 w-7 justify-center text-slate-400 transition-colors ' +
    'hover:text-violet-700 disabled:cursor-not-allowed disabled:text-slate-200 disabled:hover:text-slate-200'

  return (
    <div className={className}>
      {label && (
        <label htmlFor={fieldId} className={FIELD_LABEL_CLASS}>
          {label}
        </label>
      )}
      <div className="relative">
        <input
          id={fieldId}
          type="number"
          inputMode="numeric"
          value={Number.isFinite(value) ? value : ''}
          min={min}
          max={max}
          step={step}
          required={required}
          disabled={disabled}
          aria-label={ariaLabel}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          onChange={(e) => {
            const next = Number(e.target.value)
            // Not clamped on the way in: clamping mid-typing makes "12" become
            // "1" then jump, since the first keystroke of a two-digit number is
            // briefly below the minimum. The form's own validation catches an
            // out-of-range value at submit.
            onChange(Number.isFinite(next) ? next : NaN)
          }}
          onBlur={() => Number.isFinite(value) && onChange(clamp(value))}
          className={`${invalid ? FIELD_INVALID_CLASS : FIELD_CLASS} pr-9 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none`}
        />
        {/* Inside the field's border and clear of its rounded corner, so the
            focus ring draws around the pair rather than through them. */}
        <div className="absolute inset-y-px right-px flex w-7 flex-col overflow-hidden rounded-r-md">
          <button
            type="button"
            // Not reachable by Tab: it duplicates ArrowUp, which the input
            // already handles, and two extra stops per field is a lot of
            // tabbing for nothing new.
            tabIndex={-1}
            aria-hidden="true"
            disabled={disabled || atMax}
            onClick={() => nudge(1)}
            className={`${stepper} items-end pb-px`}
          >
            <StepArrow direction="up" />
          </button>
          <button
            type="button"
            tabIndex={-1}
            aria-hidden="true"
            disabled={disabled || atMin}
            onClick={() => nudge(-1)}
            className={`${stepper} items-start pt-px`}
          >
            <StepArrow direction="down" />
          </button>
        </div>
      </div>
    </div>
  )
}
