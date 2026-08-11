import { useEffect, useRef, useState } from 'react'

import { Button, Checkbox } from '../../design-system'
import { useExitDelay } from '../../hooks/useExitDelay'
import { TermsDocument, TERMS_UPDATED } from './TermsDocument'

/**
 * The blocking terms gate a lecturer meets on first sign-in.
 *
 * Modelled on `ConfirmDialog` — same backdrop, panel, focus trap, focus
 * restore, and body scroll lock — with two deliberate departures:
 *
 *  · **No Escape handler and no backdrop cancel.** The dialog exists to hold
 *    the app shut until the terms are answered; every dismissal route would
 *    defeat it. The only ways out are the two buttons.
 *
 *  · **Initial focus lands on the scrollable document**, not on a button —
 *    so PageDown and the arrow keys scroll the text the lecturer is being
 *    asked to read, rather than arming an action they have not earned yet.
 *
 * Two-stage arming: scrolling to the end unlocks the checkbox, the checkbox
 * unlocks Accept. The mount-time check matters — on a viewport tall enough
 * that nothing scrolls, the scroll event never fires and Accept would be
 * unreachable. (jsdom reports every scroll metric as 0, so tests arm
 * immediately; that is expected, not a bug to fix.)
 *
 * Not the design-system `Modal`: it has no focus trap, no scroll lock, no ref
 * on its body, and it is vendored — a sync would overwrite any patch. Same
 * reasoning as ConfirmDialog.tsx, at length.
 */

/** Must match `.mila-dialog[data-leaving]` in index.css. */
const DIALOG_EXIT_MS = 140

/** Everything that can hold focus, minus the ones that decline it. */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** How close to the bottom (px) counts as "read to the end". */
const END_SLACK = 8

export function TermsAcceptanceDialog({
  open,
  accepting,
  writeError,
  onAccept,
  onDecline,
}: {
  open: boolean
  accepting: boolean
  writeError: string | null
  onAccept: () => void
  onDecline: () => void
}) {
  const mounted = useExitDelay(open, DIALOG_EXIT_MS)
  const panelRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [reachedEnd, setReachedEnd] = useState(false)
  const [agreed, setAgreed] = useState(false)

  /* Initial focus: the document itself, so the keyboard reads before it acts. */
  useEffect(() => {
    if (open) scrollRef.current?.focus()
  }, [open])

  /* A viewport tall enough to show everything never fires a scroll event, so
     the end check has to run once at mount too. */
  useEffect(() => {
    if (!open) return
    const el = scrollRef.current
    if (el && el.scrollHeight <= el.clientHeight + END_SLACK) setReachedEnd(true)
  }, [open])

  /* Return focus to whatever opened it — same as ConfirmDialog. */
  useEffect(() => {
    if (!open) return undefined
    const opener = document.activeElement as HTMLElement | null
    return () => opener?.focus?.()
  }, [open])

  /* Trap Tab inside the panel. `aria-modal` does nothing to the tab order.
     Unlike ConfirmDialog there is deliberately NO Escape branch. */
  useEffect(() => {
    if (!open) return undefined
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return
      const panel = panelRef.current
      if (!panel) return
      const stops = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      )
      if (stops.length === 0) return
      const first = stops[0]
      const last = stops[stops.length - 1]
      const active = document.activeElement
      if (event.shiftKey && (active === first || !panel.contains(active))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open])

  /* The page behind must not scroll under the backdrop. */
  useEffect(() => {
    if (!open) return undefined
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [open])

  if (!mounted) return null

  const leaving = !open

  return (
    <div
      className="mila-dialog-backdrop fixed inset-0 z-[200] flex items-center justify-center p-4"
      data-leaving={leaving ? 'true' : undefined}
      /* No onPointerDown: clicking outside must not dismiss. */
    >
      <div
        ref={panelRef}
        /* `alertdialog`: it interrupts to demand an answer. */
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="terms-gate-title"
        data-leaving={leaving ? 'true' : undefined}
        className="mila-dialog flex max-h-[85vh] w-full max-w-2xl flex-col rounded-2xl border border-white/70 bg-white/97 shadow-[0_24px_60px_rgba(63,47,107,0.28)] backdrop-blur-xl"
      >
        <header className="border-b border-violet-200/60 px-6 pb-4 pt-5">
          <h2 id="terms-gate-title" className="text-lg font-semibold leading-snug text-slate-900">
            Terms and Privacy Notice
          </h2>
          <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">
            {TERMS_UPDATED} · Please read before continuing
          </p>
        </header>

        {/* tabIndex={-1}: focusable by script so PageDown works immediately,
            but not a Tab stop of its own. */}
        <div
          ref={scrollRef}
          tabIndex={-1}
          onScroll={(event) => {
            const el = event.currentTarget
            if (el.scrollTop + el.clientHeight >= el.scrollHeight - END_SLACK) {
              setReachedEnd(true)
            }
          }}
          className="min-h-0 flex-1 overflow-y-auto px-6 py-5 outline-none"
        >
          <TermsDocument />
        </div>

        <footer className="border-t border-violet-200/60 px-6 py-4">
          <Checkbox
            checked={agreed}
            disabled={!reachedEnd}
            onChange={(event) => setAgreed(event.target.checked)}
            label="I have read and agree to the Terms and Privacy Notice"
          />
          {!reachedEnd && (
            <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
              Scroll to the end of the document to continue.
            </p>
          )}
          {writeError && (
            <p role="alert" className="mt-2 text-sm leading-relaxed text-red-600">
              {writeError}
            </p>
          )}
          {/* Equal halves, as ConfirmDialog: two buttons of different widths
              under a centred panel read as a mistake. */}
          <div className="mt-4 grid grid-cols-2 gap-3">
            <Button block variant="secondary" onClick={onDecline} disabled={accepting}>
              Decline
            </Button>
            <Button
              block
              disabled={!agreed || accepting}
              loading={accepting}
              /* Greyed while shut, violet the moment it is earned — the `!`
                 overrides are needed because the design system's unlayered CSS
                 beats Tailwind's @layer utilities. Same as ConfirmDialog. */
              className="disabled:!bg-slate-200 disabled:!text-slate-500 disabled:!opacity-100 disabled:!shadow-none"
              onClick={onAccept}
            >
              Accept and continue
            </Button>
          </div>
        </footer>
      </div>
    </div>
  )
}
