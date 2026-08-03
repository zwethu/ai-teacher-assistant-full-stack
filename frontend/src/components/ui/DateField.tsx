import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { CalendarDays, ChevronLeft, ChevronRight, X } from 'lucide-react'

import { useExitDelay } from '../../hooks/useExitDelay'
import { PopoverBoundary, useFlipPlacement } from './useFlipPlacement'
import { FIELD_CLASS, FIELD_INVALID_CLASS, FIELD_LABEL_CLASS } from './fieldStyles'
import { SelectField } from './SelectField'
import {
  addDays,
  addMonths,
  formatDisplay,
  fromInputValue,
  monthGrid,
  sameDay,
  startOfDay,
  toInputValue,
} from './dateValue'

/**
 * MILA's date picker.
 *
 * The last of the three OS-drawn controls in the product, and the worst of
 * them: `<input type="date">` renders a calendar the browser owns outright —
 * Chrome's is a grey box with blue selection, Firefox's is a different grey box
 * with a different blue, Safari's on iOS is a scroll wheel. The field beside it
 * is violet; the calendar that opens out of it never is.
 *
 * The value contract is unchanged from the native input on purpose —
 * `YYYY-MM-DD`, or `YYYY-MM-DDTHH:mm` with `withTime` — so the five call sites
 * swapped one element for another and nothing downstream had to move.
 *
 * **What this is not.** The date-picker checklist is written for *range*
 * pickers — hover previews, draggable edges, two months side by side, "Last 30
 * days". None of that applies here: every date in this product is a single
 * forward-looking moment (a deadline, a send time, the day a journal entry is
 * about), and there is nowhere to select a range. What does carry across is
 * taken seriously: presets for the common cases, month and year reachable
 * directly instead of by clicking "next" four times, the full keyboard, and a
 * sheet rather than a shrunken popover on a phone.
 */

export type DatePreset = {
  label: string
  /**
   * The date the preset means, given the moment it was clicked.
   *
   * Deliberately *not* given the field's current value: "Tomorrow" names one
   * day, the one after today, and it has to keep naming it however many times
   * it is pressed. Resolving from the selection instead made the chips
   * step-relative — a second press meant the day after that.
   */
  resolve: (now: Date) => Date
}

/**
 * Every date field in the app points forward — a deadline, a scheduled send.
 * "Last 7 days" would be nonsense on all of them; these are the three answers
 * a lecturer actually gives.
 */
export const DEADLINE_PRESETS: DatePreset[] = [
  { label: 'Today', resolve: (now) => now },
  { label: 'Tomorrow', resolve: (now) => addDays(now, 1) },
  { label: 'Next week', resolve: (now) => addDays(now, 7) },
]

export type DateFieldProps = {
  /** `YYYY-MM-DD`, or `YYYY-MM-DDTHH:mm` when `withTime`. */
  value: string
  onChange: (value: string) => void
  withTime?: boolean
  label?: ReactNode
  /** Earliest selectable value, in the same format. Earlier days are disabled. */
  min?: string
  max?: string
  placeholder?: string
  disabled?: boolean
  invalid?: boolean
  required?: boolean
  id?: string
  className?: string
  presets?: DatePreset[]
  'aria-label'?: string
}

/** Matches `.mila-menu[data-leaving]`. */
const MENU_EXIT_MS = 140
/** Only for the frame before the panel has been laid out and measured. */
const PANEL_H_FALLBACK = 400

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/** What a screen reader should hear on a day cell. */
export function fullDayLabel(date: Date): string {
  return date.toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

/** Twelve years back, twelve forward — a teaching calendar never needs more. */
function yearOptions(around: number) {
  return Array.from({ length: 25 }, (_, i) => {
    const year = around - 12 + i
    return { value: String(year), label: String(year) }
  })
}

const MONTH_OPTIONS = Array.from({ length: 12 }, (_, i) => ({
  value: String(i),
  label: new Date(2000, i, 1).toLocaleDateString(undefined, { month: 'long' }),
}))

/**
 * Does the reader's locale write half past two as 14:30 or as 2:30 PM?
 *
 * Read once, from the same source `toLocaleTimeString` consults — so the
 * picker and the value it writes into the closed field always agree. A 24-hour
 * picker under a "2:30 PM" display is the kind of small contradiction that
 * makes someone re-check the value they just set.
 */
const HOUR12 = new Intl.DateTimeFormat().resolvedOptions().hour12 ?? false

const pad2 = (n: number) => String(n).padStart(2, '0')

/** 00–23, or 12/1–11 with a meridiem beside it. */
const HOUR_OPTIONS = HOUR12
  ? Array.from({ length: 12 }, (_, i) => {
      const hour = i === 0 ? 12 : i
      return { value: String(hour), label: String(hour) }
    })
  : Array.from({ length: 24 }, (_, i) => ({ value: String(i), label: pad2(i) }))

/** Every minute, not five-minute steps — 23:59 is a real deadline. */
const MINUTE_OPTIONS = Array.from({ length: 60 }, (_, i) => ({
  value: String(i),
  label: pad2(i),
}))

const MERIDIEM_OPTIONS = [
  { value: 'AM', label: 'AM' },
  { value: 'PM', label: 'PM' },
]

/** The four times a teaching deadline actually lands on. */
const TIME_PRESETS: Array<[number, number]> = [
  [9, 0],
  [12, 0],
  [17, 0],
  [23, 59],
]

function formatClock(hours: number, minutes: number): string {
  return new Date(2000, 0, 1, hours, minutes).toLocaleTimeString(undefined, {
    hour: HOUR12 ? 'numeric' : '2-digit',
    minute: '2-digit',
  })
}

/**
 * Hour and minute as dropdowns, plus the handful of times that cover most of
 * the answers.
 *
 * Built out of `SelectField` rather than as a wheel or a pair of steppers,
 * which buys the whole of its behaviour for free: both columns are searchable,
 * so "45" reaches minute 45 in two keystrokes rather than a scroll through
 * sixty rows, and the keyboard, the motion and the focus ring are the ones
 * every other control in the app already uses. A native `<input type="time">`
 * was what this replaced — typing-only, and drawing its own OS clock button
 * that opened a second picker on top of ours.
 */
function TimePicker({
  date,
  onChange,
}: {
  date: Date
  onChange: (hours: number, minutes: number) => void
}) {
  const hours = date.getHours()
  const minutes = date.getMinutes()
  const displayHour = HOUR12 ? (hours % 12 === 0 ? 12 : hours % 12) : hours
  const meridiem = hours < 12 ? 'AM' : 'PM'

  /** 12-hour parts back to a 24-hour clock. Noon and midnight are the traps:
   *  12 AM is 0 and 12 PM is 12, so the modulo has to come first. */
  const to24 = (hour12: number, half: string) => (hour12 % 12) + (half === 'PM' ? 12 : 0)

  return (
    <div className="mt-3 border-t border-slate-100 pt-3">
      <div className="flex items-center gap-1.5">
        <span className="mr-0.5 text-sm font-medium text-slate-600">Time</span>
        <SelectField
          aria-label="Hour"
          className="w-[4.25rem]"
          value={String(displayHour)}
          options={HOUR_OPTIONS}
          onChange={(h) => onChange(HOUR12 ? to24(Number(h), meridiem) : Number(h), minutes)}
        />
        <span aria-hidden="true" className="text-slate-400">
          :
        </span>
        <SelectField
          aria-label="Minute"
          className="w-[4.25rem]"
          value={String(minutes)}
          options={MINUTE_OPTIONS}
          onChange={(m) => onChange(hours, Number(m))}
        />
        {HOUR12 && (
          <SelectField
            aria-label="AM or PM"
            className="w-[4.75rem]"
            value={meridiem}
            options={MERIDIEM_OPTIONS}
            onChange={(half) => onChange(to24(displayHour, half), minutes)}
          />
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {TIME_PRESETS.map(([h, m]) => {
          const active = h === hours && m === minutes
          return (
            <button
              key={`${h}:${m}`}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(h, m)}
              className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                active
                  ? 'border-violet-300 bg-violet-50 text-violet-800'
                  : 'border-slate-200 text-slate-600 hover:border-violet-300 hover:bg-violet-50 hover:text-violet-800'
              }`}
            >
              {formatClock(h, m)}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function DateField({
  value,
  onChange,
  withTime = false,
  label,
  min,
  max,
  placeholder,
  disabled = false,
  invalid = false,
  required,
  id,
  className = '',
  presets = DEADLINE_PRESETS,
  'aria-label': ariaLabel,
}: DateFieldProps) {
  const generatedId = useId()
  const fieldId = id ?? `date-${generatedId}`
  const panelId = `${fieldId}-panel`

  const selected = useMemo(() => fromInputValue(value), [value])
  const minDate = useMemo(() => fromInputValue(min), [min])
  const maxDate = useMemo(() => fromInputValue(max), [max])

  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')

  // The day the arrow keys are sitting on. Separate from the selection: you
  // move around the grid first and commit second, so the two are only the same
  // right after a click.
  const [cursor, setCursor] = useState<Date>(() => selected ?? new Date())

  const wrapRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const panelMounted = useExitDelay(open, MENU_EXIT_MS)
  /* Measured, not assumed. The old constant said 380px and the panel grew past
     it when the time picker arrived, so it stopped flipping and ran off the
     bottom of the page. */
  const { dropUp, maxHeight } = useFlipPlacement(wrapRef, panelRef, open, {
    fallbackHeight: PANEL_H_FALLBACK,
  })

  const isDisabledDay = useCallback(
    (day: Date) => {
      if (minDate && startOfDay(day) < startOfDay(minDate)) return true
      if (maxDate && startOfDay(day) > startOfDay(maxDate)) return true
      return false
    },
    [minDate, maxDate],
  )

  const close = useCallback((restoreFocus: boolean) => {
    setOpen(false)
    setText('')
    if (restoreFocus) inputRef.current?.focus()
  }, [])

  const openPanel = useCallback(() => {
    if (disabled) return
    setText('')
    setCursor(selected ?? minDate ?? new Date())
    setOpen(true)
  }, [disabled, selected, minDate])

  /**
   * Commit a day, carrying the time across.
   *
   * Picking a new day must not silently reset a 23:59 deadline to midnight,
   * which is what writing the grid's own zeroed date would do.
   */
  const commitDay = useCallback(
    (day: Date, closeAfter: boolean) => {
      if (isDisabledDay(day)) return
      const next = new Date(day)
      if (withTime) {
        const base = selected ?? new Date()
        next.setHours(base.getHours(), base.getMinutes(), 0, 0)
      }
      onChange(toInputValue(next, withTime))
      // With a time to set, the panel stays open — the lecturer is halfway
      // through a two-part answer, and closing on the first half means
      // re-opening it to finish.
      if (closeAfter && !withTime) close(true)
    },
    [close, isDisabledDay, onChange, selected, withTime],
  )

  const setTime = (hours: number, minutes: number) => {
    const next = new Date(selected ?? cursor)
    next.setHours(hours, minutes, 0, 0)
    onChange(toInputValue(next, true))
  }

  useEffect(() => {
    if (!open) return undefined
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) close(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open, close])

  /**
   * Grid navigation, wherever focus happens to be.
   *
   * Focus stays on the trigger while the panel is open — the combobox model,
   * with `aria-activedescendant` naming the day the arrows are on. An earlier
   * version moved real focus onto the cursor cell instead, and lost: clicking
   * the trigger opens the panel on `mousedown` and focuses the input on the
   * `focus` that follows, so the cell was focused and then immediately robbed,
   * and every arrow key sailed into an input that did nothing with it.
   *
   * Returns whether it consumed the key, so the trigger can fall through to
   * its own handling for anything left.
   */
  const navigate = useCallback(
    (event: KeyboardEvent<HTMLElement>): boolean => {
      const moves: Record<string, number> = {
        ArrowLeft: -1,
        ArrowRight: 1,
        ArrowUp: -7,
        ArrowDown: 7,
      }
      if (event.key in moves) {
        event.preventDefault()
        setCursor((c) => addDays(c, moves[event.key]))
        return true
      }
      switch (event.key) {
        case 'PageUp':
          event.preventDefault()
          // Shift jumps a year, which is the checklist's ask and costs a word.
          setCursor((c) => addMonths(c, event.shiftKey ? -12 : -1))
          return true
        case 'PageDown':
          event.preventDefault()
          setCursor((c) => addMonths(c, event.shiftKey ? 12 : 1))
          return true
        case 'Home':
          event.preventDefault()
          setCursor((c) => addDays(c, -((c.getDay() + 6) % 7)))
          return true
        case 'End':
          event.preventDefault()
          setCursor((c) => addDays(c, 6 - ((c.getDay() + 6) % 7)))
          return true
        default:
          return false
      }
    },
    [],
  )

  function handleGridKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (navigate(event)) return
    switch (event.key) {
      case 'Enter':
      case ' ':
        event.preventDefault()
        commitDay(cursor, true)
        return
      case 'Escape':
        event.preventDefault()
        close(true)
        return
      default:
    }
  }

  function handleInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!open) {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        openPanel()
      }
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      close(true)
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      if (text.trim()) {
        // Something was typed, so that is what they mean — not wherever the
        // grid cursor happens to be sitting. Text that does not parse commits
        // nothing at all: silently taking the cursor instead would answer a
        // question they did not ask, and the field reverts on close anyway.
        const typed = fromInputValue(text)
        if (!typed) return
        commitDay(typed, true)
        if (withTime) close(true)
        return
      }
      commitDay(cursor, true)
      return
    }
    navigate(event)
  }

  const grid = useMemo(() => monthGrid(cursor), [cursor])
  const today = startOfDay(new Date())

  const panel = (
    <div className="p-3">
      {/* Month and year as dropdowns, not as a label between two chevrons.
          Reaching next March from this August is one click each, rather than
          seven presses of "next". */}
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => setCursor((c) => addMonths(c, -1))}
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-violet-50 hover:text-violet-700"
          aria-label="Previous month"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <SelectField
          aria-label="Month"
          className="min-w-0 flex-1"
          value={String(cursor.getMonth())}
          options={MONTH_OPTIONS}
          onChange={(m) => setCursor((c) => new Date(c.getFullYear(), Number(m), 1))}
        />
        <SelectField
          aria-label="Year"
          className="w-[5.5rem] flex-shrink-0"
          value={String(cursor.getFullYear())}
          options={yearOptions(cursor.getFullYear())}
          onChange={(y) => setCursor((c) => new Date(Number(y), c.getMonth(), 1))}
        />
        <button
          type="button"
          onClick={() => setCursor((c) => addMonths(c, 1))}
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-violet-50 hover:text-violet-700"
          aria-label="Next month"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-3 grid grid-cols-7 gap-0.5">
        {WEEKDAYS.map((day) => (
          <div key={day} className="pb-1 text-center text-[11px] font-semibold text-slate-400">
            {day}
          </div>
        ))}
      </div>

      {/* One key handler on the grid rather than 42 on the cells: only the
          cursor cell is ever focused, so the event lands here regardless. */}
      <div
        ref={gridRef}
        role="grid"
        aria-label="Calendar"
        onKeyDown={handleGridKeyDown}
        className="grid grid-cols-7 gap-0.5"
      >
        {grid.map((day) => {
          const outside = day.getMonth() !== cursor.getMonth()
          const isSelected = selected ? sameDay(day, selected) : false
          const isCursor = sameDay(day, cursor)
          const isToday = sameDay(day, today)
          const blocked = isDisabledDay(day)
          return (
            <button
              key={day.toISOString()}
              type="button"
              role="gridcell"
              // Roving tabindex — one stop for the whole grid, not forty-two.
              id={`${fieldId}-day-${toInputValue(day, false)}`}
              tabIndex={isCursor ? 0 : -1}
              data-cursor={isCursor ? 'true' : undefined}
              data-outside={outside ? 'true' : undefined}
              // A bare "5" leaves a screen reader guessing which month it is
              // in, and a third of this grid belongs to a different one.
              aria-label={fullDayLabel(day)}
              aria-selected={isSelected}
              aria-current={isToday ? 'date' : undefined}
              disabled={blocked}
              onClick={() => {
                setCursor(day)
                commitDay(day, true)
              }}
              className={[
                'relative flex h-9 items-center justify-center rounded-md text-sm transition-colors',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500',
                blocked
                  ? 'cursor-not-allowed text-slate-300'
                  : isSelected
                    ? 'bg-violet-600 font-semibold text-white hover:bg-violet-700'
                    : outside
                      ? /* Recessed but readable, and these days are clickable —
                           slate-400 measured 2.6:1 on white and 2.3:1 on the
                           slate hover it used to carry. Slate-500 is 4.8:1 and
                           still a clear step down from the slate-700 of the
                           month you are actually in. */
                        'text-slate-500 hover:bg-violet-50 hover:text-violet-900'
                      : 'text-slate-700 hover:bg-violet-50 hover:text-violet-900',
              ].join(' ')}
            >
              {day.getDate()}
              {/* Today keeps a marker even when it is the selection, where a
                  ring would be invisible against the violet fill. */}
              {isToday && (
                <span
                  aria-hidden="true"
                  className={`absolute bottom-1 h-1 w-1 rounded-full ${
                    isSelected ? 'bg-white' : 'bg-violet-500'
                  }`}
                />
              )}
            </button>
          )
        })}
      </div>

      {withTime && (
        <TimePicker
          date={selected ?? cursor}
          onChange={(hours, minutes) => setTime(hours, minutes)}
        />
      )}

      {presets.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5 border-t border-slate-100 pt-3">
          {presets.map((preset) => (
            <button
              key={preset.label}
              type="button"
              onClick={() => {
                const next = preset.resolve(new Date())
                setCursor(next)
                commitDay(next, true)
              }}
              className="rounded-full border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 transition-colors hover:border-violet-300 hover:bg-violet-50 hover:text-violet-800"
            >
              {preset.label}
            </button>
          ))}
          {/* On a phone the panel is a sheet with no obvious way out, and the
              backdrop is not a discoverable one. */}
          <button
            type="button"
            onClick={() => close(true)}
            className="ml-auto rounded-full px-2.5 py-1 text-xs font-semibold text-violet-700 hover:bg-violet-50 sm:hidden"
          >
            Done
          </button>
        </div>
      )}
    </div>
  )

  return (
    <div className={`relative ${className}`} ref={wrapRef}>
      {label && (
        <label htmlFor={fieldId} className={FIELD_LABEL_CLASS}>
          {label}
        </label>
      )}
      <div className="relative">
        <input
          id={fieldId}
          ref={inputRef}
          type="text"
          autoComplete="off"
          spellCheck={false}
          disabled={disabled}
          required={required}
          aria-label={ariaLabel}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? panelId : undefined}
          aria-activedescendant={open ? `${fieldId}-day-${toInputValue(cursor, false)}` : undefined}
          // Closed it reads as a date; open it becomes the ISO form, which is
          // the one shape that is unambiguous to type. Same trade as
          // `SelectField`: the friendly string is for reading, not for editing.
          value={open ? text : selected ? formatDisplay(selected, withTime) : ''}
          placeholder={placeholder ?? (withTime ? 'YYYY-MM-DD HH:mm' : 'YYYY-MM-DD')}
          readOnly={!open}
          onChange={(e) => setText(e.target.value)}
          onMouseDown={(e) => {
            if (disabled) return
            if (open) {
              e.preventDefault()
              close(true)
            } else {
              openPanel()
            }
          }}
          onKeyDown={handleInputKeyDown}
          className={`${invalid ? FIELD_INVALID_CLASS : FIELD_CLASS} cursor-pointer pr-9`}
        />
        <CalendarDays
          aria-hidden="true"
          className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
        />
      </div>

      {panelMounted && (
        <>
          {/* Phone only. A popover shrunk onto a 375px screen is unusable, so
              below `sm` the same panel is a bottom sheet with a scrim. */}
          <div
            aria-hidden="true"
            onClick={() => close(false)}
            className={`fixed inset-0 z-40 bg-slate-900/40 sm:hidden ${
              open ? 'opacity-100' : 'opacity-0'
            } transition-opacity duration-150`}
          />
          <div
            id={panelId}
            ref={panelRef}
            /* Only ever set when the panel cannot fit on either side of the
               trigger — a short viewport, or the field near the fold. Left
               undefined otherwise, so no scrollbar appears and the dropdowns
               inside are not clipped. Phone widths keep their own sheet cap. */
            style={maxHeight ? { ['--mila-panel-max' as string]: `${maxHeight}px` } : undefined}
            role="dialog"
            aria-modal="false"
            aria-label={`${typeof label === 'string' ? label : (ariaLabel ?? 'Date')} calendar`}
            aria-hidden={open ? undefined : true}
            data-leaving={open ? undefined : 'true'}
            data-placement={dropUp ? 'top' : 'bottom'}
            // Read only by the phone-width media query, which swaps the
            // dropdown's small drop for a rise out of the bottom edge.
            data-sheet="true"
            className={[
              'mila-menu z-50 rounded-2xl border border-slate-200 bg-white shadow-xl',
              // Sheet on a phone…
              'fixed inset-x-0 bottom-0 max-h-[85vh] overflow-y-auto rounded-b-none',
              // …popover from `sm` up. The scroll is dropped with it: the
              // panel now contains dropdowns of its own (month, year, hour,
              // minute), and `overflow-y-auto` on their ancestor clips them to
              // its box. A sheet has to scroll and lives with that; a popover
              // is short enough not to need to.
              'sm:absolute sm:inset-x-auto sm:bottom-auto sm:z-40 sm:w-[21rem] sm:rounded-b-2xl',
              maxHeight
                ? 'sm:max-h-[var(--mila-panel-max)] sm:overflow-y-auto'
                : 'sm:max-h-none sm:overflow-visible',
              dropUp ? 'sm:bottom-full sm:mb-1.5' : 'sm:top-full sm:mt-1.5',
            ].join(' ')}
          >
            <PopoverBoundary value={panelRef}>
            <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2 sm:hidden">
              <span className="text-sm font-semibold text-slate-700">
                {typeof label === 'string' ? label : 'Choose a date'}
              </span>
              <button
                type="button"
                onClick={() => close(true)}
                className="flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {panel}
            </PopoverBoundary>
          </div>
        </>
      )}
    </div>
  )
}
