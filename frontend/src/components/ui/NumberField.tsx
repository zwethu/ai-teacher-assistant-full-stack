import { useId, type ReactNode } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'

import { FIELD_CLASS, FIELD_LABEL_CLASS } from './fieldStyles'

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
 * So the native spinner is switched off and two chevrons are drawn in its
 * place, in the brand's own colours, always visible.
 *
 * Typing stays the primary path — the steppers are for a nudge, which is what
 * "next week" usually is. They are about 20px tall each, under the 44px a
 * touch target wants; that is a deliberate trade for a control that has to fit
 * inside a 42px field, and nothing here is reachable *only* by tapping them.
 */

export type NumberFieldProps = {
  value: number
  onChange: (value: number) => void
  label?: ReactNode
  min?: number
  max?: number
  step?: number
  required?: boolean
  disabled?: boolean
  id?: string
  className?: string
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
  id,
  className = '',
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

  const stepper =
    'flex h-1/2 w-7 items-center justify-center text-slate-400 transition-colors ' +
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
          onChange={(e) => {
            const next = Number(e.target.value)
            // Not clamped on the way in: clamping mid-typing makes "12" become
            // "1" then jump, since the first keystroke of a two-digit number is
            // briefly below the minimum. The form's own validation catches an
            // out-of-range value at submit.
            onChange(Number.isFinite(next) ? next : NaN)
          }}
          onBlur={() => Number.isFinite(value) && onChange(clamp(value))}
          className={`${FIELD_CLASS} pr-9 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none`}
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
            className={stepper}
          >
            <ChevronUp className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            tabIndex={-1}
            aria-hidden="true"
            disabled={disabled || atMin}
            onClick={() => nudge(-1)}
            className={stepper}
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  )
}
