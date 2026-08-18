import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { useExitDelay } from '../../hooks/useExitDelay'
import { FIELD_CLASS, FIELD_LABEL_CLASS } from './fieldStyles'
import { useFlipPlacement } from './useFlipPlacement'

/**
 * MILA's dropdown.
 *
 * A native `<select>` renders the operating system's list, which is the one
 * surface in the app the brand cannot reach — grey on Windows, translucent on
 * macOS, and on neither does it know what a violet focus ring is. Every
 * generation form was built out of them, so the most-used control in the
 * product was also the only one that looked like it belonged to something else.
 *
 * This is the WAI-ARIA editable combobox: the trigger *is* the text field.
 * Click it and it becomes editable; type and the list narrows in place. That
 * matters more than it sounds — a separate search box inside the popup is
 * reasonable machinery for a list of forty and absurd for a list of three, and
 * these forms have both. Making the trigger the input means the same control
 * behaves the same way at every length, and a three-option list simply narrows
 * to one on the first keystroke.
 *
 * Deliberately not a `<select>` underneath. A hidden native control kept in
 * sync would give us form participation for free, but it also re-introduces the
 * thing being replaced: browsers fire the OS picker for a focused select, and
 * the two would fight over the keyboard. Callers here submit through React
 * state, so nothing is lost. `required` is enforced by the caller's own
 * validation, as it already was.
 */

export type SelectOption = {
  value: string
  label: string
  /** Optional second line — used for the batch picker's course name. */
  hint?: string
}

export type SelectFieldProps = {
  value: string
  onChange: (value: string) => void
  options: SelectOption[]
  /** Rendered above the control, and wired to it as a real `<label>`. */
  label?: ReactNode
  placeholder?: string
  disabled?: boolean
  id?: string
  /** Applied to the wrapper, for width and grid placement. */
  className?: string
  /** Only needed when there is no visible `label`. */
  'aria-label'?: string
}

/** Matches `.mila-menu[data-leaving]` in index.css. */
const MENU_EXIT_MS = 140
/** Only for the frame before the popup has been laid out and measured. */
const MENU_H_FALLBACK = 264

/**
 * Case-insensitive substring, over label and hint both: someone looking for a
 * batch is at least as likely to remember the course as the cohort name.
 */
function matches(option: SelectOption, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  return `${option.label} ${option.hint ?? ''}`.toLowerCase().includes(needle)
}

/**
 * The matched run of characters, drawn in brand colour.
 *
 * Without it a narrowed list is just a shorter list, and on a near-miss — two
 * options left, one matching in the hint — there is nothing on screen saying
 * why either survived.
 */
function Highlight({ text, query }: { text: string; query: string }) {
  const needle = query.trim().toLowerCase()
  if (!needle) return <>{text}</>
  const at = text.toLowerCase().indexOf(needle)
  if (at < 0) return <>{text}</>
  return (
    <>
      {text.slice(0, at)}
      <span className="font-semibold text-violet-700">{text.slice(at, at + needle.length)}</span>
      {text.slice(at + needle.length)}
    </>
  )
}

export function SelectField({
  value,
  onChange,
  options,
  label,
  placeholder = 'Select…',
  disabled = false,
  id,
  className = '',
  'aria-label': ariaLabel,
}: SelectFieldProps) {
  const generatedId = useId()
  const fieldId = id ?? `select-${generatedId}`
  const listId = `${fieldId}-listbox`

  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)


  const wrapRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  // Kept mounted through its exit so the popup can leave rather than vanish.
  const menuMounted = useExitDelay(open, MENU_EXIT_MS)
  /* Shares the calendar's placement logic: measured rather than assumed, and
     re-measured when the page scrolls under an open menu. */
  const { dropUp, maxHeight } = useFlipPlacement(wrapRef, listRef, open, {
    fallbackHeight: MENU_H_FALLBACK,
  })

  const selected = useMemo(() => options.find((o) => o.value === value), [options, value])
  const visible = useMemo(() => options.filter((o) => matches(o, query)), [options, query])

  const close = useCallback((restoreFocus: boolean) => {
    setOpen(false)
    setQuery('')
    if (restoreFocus) inputRef.current?.focus()
  }, [])

  const commit = useCallback(
    (option: SelectOption) => {
      onChange(option.value)
      close(true)
    },
    [close, onChange],
  )

  const openMenu = useCallback(() => {
    if (disabled) return
    setQuery('')
    // Land on the current value rather than the top of the list, so opening
    // and pressing Enter is a no-op instead of a silent change.
    setActiveIndex(Math.max(0, options.findIndex((o) => o.value === value)))
    setOpen(true)
  }, [disabled, options, value])

  // A filtered list can be shorter than where the cursor was.
  useEffect(() => {
    setActiveIndex((current) => Math.min(current, Math.max(0, visible.length - 1)))
  }, [visible.length])

  // Keyboard navigation has to be able to reach past the popup's own scroll.
  useEffect(() => {
    if (!open) return
    const row = listRef.current?.querySelector('[data-active="true"]')
    // jsdom implements no layout and so ships no `scrollIntoView`. Guarding
    // rather than stubbing it in the tests: this is an enhancement on top of a
    // list that is already fully navigable, and nothing here should throw in an
    // environment that cannot scroll in the first place.
    if (row instanceof HTMLElement && typeof row.scrollIntoView === 'function') {
      row.scrollIntoView({ block: 'nearest' })
    }
  }, [open, activeIndex, visible.length])

  /* Pointerdown, not click: a click on another control fires after that
     control has already taken focus, and closing on the later event let a
     second dropdown open while this one was still on screen. */
  useEffect(() => {
    if (!open) return undefined
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) close(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open, close])

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        event.preventDefault()
        if (!open) {
          openMenu()
          return
        }
        if (visible.length === 0) return
        const step = event.key === 'ArrowDown' ? 1 : -1
        // Wraps, because a list this short is faster to reach by going the
        // other way than by holding the key against a stop.
        setActiveIndex((i) => (i + step + visible.length) % visible.length)
        return
      }
      case 'Home':
      case 'End': {
        if (!open) return
        event.preventDefault()
        setActiveIndex(event.key === 'Home' ? 0 : visible.length - 1)
        return
      }
      case 'Enter': {
        if (!open) return
        // Only swallowed while the popup is open — otherwise this would eat
        // the Enter that submits the form the field sits in.
        event.preventDefault()
        const option = visible[activeIndex]
        if (option) commit(option)
        return
      }
      case 'Escape': {
        if (!open) return
        event.preventDefault()
        close(true)
        return
      }
      case 'Tab': {
        // Let focus leave; just do not leave a popup behind it.
        if (open) close(false)
        return
      }
      default: {
        /* Type-to-open. The field is read-only while closed — it is showing
           the selected label, not the query, so a keystroke landing in it
           would append to that label and search for "Software Testing 26d".
           Taking the character here instead makes the first keystroke the
           whole query, which is what someone typing at a closed dropdown
           means. `setOpen` directly rather than `openMenu`, which would clear
           the character we just took. */
        if (open || disabled) return
        if (event.key.length !== 1 || event.metaKey || event.ctrlKey || event.altKey) return
        event.preventDefault()
        setQuery(event.key)
        setActiveIndex(0)
        setOpen(true)
      }
    }
  }

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
          role="combobox"
          autoComplete="off"
          spellCheck={false}
          disabled={disabled}
          aria-label={ariaLabel}
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-autocomplete="list"
          aria-activedescendant={open && visible[activeIndex] ? `${listId}-${activeIndex}` : undefined}
          /* Closed, this shows the selection; open, it shows what is being
             typed and demotes the selection to the placeholder — so the
             current value stays legible while the list is being narrowed. */
          value={open ? query : selected?.label ?? ''}
          placeholder={open ? selected?.label ?? placeholder : placeholder}
          // Editable only while open, when it is showing the query. Closed it
          // is showing the selection, which is a label rather than a value —
          // see the type-to-open branch in the key handler.
          readOnly={!open}
          onChange={(e) => {
            setQuery(e.target.value)
            setActiveIndex(0)
          }}
          /* Click toggles, and focus deliberately does not open. Tabbing
             through a form should not leave a trail of popped-open dropdowns
             behind it — which is also how a native select behaves, and the
             reason keyboard users get ArrowDown and type-to-open instead. */
          onMouseDown={(e) => {
            if (disabled) return
            if (open) {
              // Must not re-open on the focus that follows the click.
              e.preventDefault()
              close(true)
            } else {
              openMenu()
            }
          }}
          onKeyDown={handleKeyDown}
          // `pr-9` clears the caret; the rest is the shared control style, so a
          // dropdown and the text field beside it cannot drift apart again.
          className={`${FIELD_CLASS} cursor-pointer truncate pr-9`}
        />
        <ChevronDown
          aria-hidden="true"
          className={`pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 transition-transform duration-200 ${
            open ? 'rotate-180' : ''
          }`}
        />
      </div>

      {menuMounted && (
        <ul
          id={listId}
          role="listbox"
          ref={listRef}
          /* On its way out it is still painted but no longer part of the
             control: `menuMounted` outlives `open` by the length of the exit,
             and a listbox left in the accessibility tree for that 140ms is one
             a screen reader can be told about after the field has already
             reported itself collapsed. */
          aria-hidden={open ? undefined : true}
          data-leaving={open ? undefined : 'true'}
          data-placement={dropUp ? 'top' : 'bottom'}
          style={{ maxHeight: Math.min(maxHeight ?? MENU_H_FALLBACK, MENU_H_FALLBACK) }}
          className={`mila-menu absolute z-40 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-lg ${
            dropUp ? 'bottom-full mb-1.5' : 'top-full mt-1.5'
          }`}
        >
          {visible.length === 0 ? (
            <li className="px-3 py-2 text-sm text-slate-400">No matches</li>
          ) : (
            visible.map((option, index) => {
              const isSelected = option.value === value
              const isActive = index === activeIndex
              return (
                <li
                  key={option.value}
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={isSelected}
                  data-active={isActive ? 'true' : undefined}
                  /* Delay compounds down the list, so the options arrive as a
                     run rather than a block. Capped so a long list does not
                     make the last row wait on the first thirty. */
                  style={{ '--mila-menu-delay': `${Math.min(index, 8) * 18}ms` } as CSSProperties}
                  // Mouse *move*, not enter: with the pointer resting over the
                  // list, opening the popup under it would otherwise steal the
                  // active row away from the keyboard before a key was pressed.
                  onMouseMove={() => setActiveIndex(index)}
                  // Down rather than click, so the input never blurs first.
                  onMouseDown={(e) => {
                    e.preventDefault()
                    commit(option)
                  }}
                  className={`mila-menu__option flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-sm ${
                    isActive ? 'bg-violet-50 text-violet-900' : 'text-slate-700'
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate">
                    <Highlight text={option.label} query={query} />
                    {option.hint && (
                      /* Secondary, but still readable: the hint carries the
                         course name, which is one of the things typing here
                         searches. Slate-400 measured 2.6:1 on white and 2.3:1
                         on the active row's violet tint — the second number is
                         what settles it, since a grey that dim on a coloured
                         wash reads as smudged rather than as quiet. Slate-500
                         is 4.8:1 at rest, and the active row switches to
                         violet-600 (6.5:1) rather than staying grey on colour. */
                      <span className={`ml-1.5 text-xs ${isActive ? 'text-violet-600' : 'text-slate-500'}`}>
                        <Highlight text={option.hint} query={query} />
                      </span>
                    )}
                  </span>
                  {isSelected && <Check aria-hidden="true" className="h-4 w-4 flex-shrink-0 text-violet-600" />}
                </li>
              )
            })
          )}
        </ul>
      )}
    </div>
  )
}

/** Build options from a list of plain strings, with an optional relabeller. */
export function toOptions(values: readonly string[], label?: (v: string) => string): SelectOption[] {
  return values.map((v) => ({ value: v, label: label ? label(v) : v }))
}
