import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { TriangleAlert } from 'lucide-react'

import { Button } from '../../design-system'
import { useExitDelay } from '../../hooks/useExitDelay'
import { FIELD_CLASS } from './fieldStyles'
import {
  getConfirmRequest,
  settleConfirm,
  subscribeConfirm,
  type ConfirmRequest,
} from './confirmStore'

/**
 * The dialog behind `confirm()`.
 *
 * **Written here rather than using `design-system/components/feedback/Modal`,**
 * for the same two reasons `Toast` was: that file is vendored from the upstream
 * design project and a sync would overwrite any edit, and it is not actually on
 * theme — its backdrop is `rgba(30,58,138,.30)` and its header a gradient of
 * `--azure-50`, both from the pre-MILA blue ramp that the palette migration
 * retired. It also claims `aria-modal="true"` while implementing none of it:
 * no Escape, no focus trap, no focus restore, and no exit — `if (!open) return
 * null` blinks it out of existence.
 *
 * What this one does differently, beyond the palette:
 *
 *  · **The question is the title and the consequence is the body.** Every
 *    message this replaced was already written that way — `Delete "x"?` then a
 *    blank line then what that costs — and `window.confirm` flattened both into
 *    one run of grey system text.
 *
 *  · **Focus starts on Cancel** whenever the confirm button is destructive. The
 *    dialog interrupts; whatever the hands were already doing should not be
 *    able to complete the dangerous half of it.
 *
 *  · **Escape and the backdrop both cancel**, which is safe in one direction
 *    only — dismissing never destroys anything.
 */

/** Must match `.mila-dialog[data-leaving]` in index.css. */
const DIALOG_EXIT_MS = 140

/** Everything that can hold focus, minus the ones that decline it. */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function ConfirmDialog({
  request,
  onSettle,
}: {
  request: ConfirmRequest | null
  onSettle: (id: number, confirmed: boolean) => void
}) {
  const mounted = useExitDelay(request !== null, DIALOG_EXIT_MS)
  const panelRef = useRef<HTMLDivElement>(null)
  const [typed, setTyped] = useState('')

  /* The last live request, so the dialog can still draw itself while leaving —
     by then the store has already dropped it and there would be no text left.
     Written during render because the exit begins on the very frame it goes
     null, and an effect would blank the words a frame before they faded. */
  const last = useRef<ConfirmRequest | null>(null)
  if (request) last.current = request
  const shown = last.current

  const phrase = shown?.confirmPhrase
  const canConfirm = !phrase || typed.trim() === phrase.trim()

  // A fresh question must not inherit the last one's typing.
  useEffect(() => {
    if (request) setTyped('')
  }, [request?.id])

  const cancel = useCallback(() => {
    if (request) onSettle(request.id, false)
  }, [request, onSettle])

  /**
   * Return focus to whatever opened it.
   *
   * Without this the dialog closes and focus falls back to `<body>`, so the
   * next Tab starts from the top of the page — a keyboard user loses their
   * place every time they cancel.
   */
  useEffect(() => {
    if (!request) return undefined
    const opener = document.activeElement as HTMLElement | null
    return () => opener?.focus?.()
  }, [request?.id])

  /* Initial focus: the phrase input when there is one to type, otherwise
     Cancel for anything destructive and the confirm button when it is not. */
  useEffect(() => {
    if (!request) return
    const panel = panelRef.current
    if (!panel) return
    const target =
      panel.querySelector<HTMLElement>('[data-confirm-phrase]') ??
      panel.querySelector<HTMLElement>(
        request.tone === 'danger' ? '[data-confirm-cancel]' : '[data-confirm-accept]',
      )
    target?.focus()
  }, [request?.id])

  /**
   * Trap Tab inside the panel.
   *
   * `aria-modal` tells a screen reader the rest of the page is gone; it does
   * nothing whatsoever to the tab order, so without this Tab walks straight out
   * of the dialog and into the page it is supposed to be blocking.
   */
  useEffect(() => {
    if (!request) return undefined
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        cancel()
        return
      }
      if (event.key !== 'Tab') return
      const panel = panelRef.current
      if (!panel) return
      const stops = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      )
      if (stops.length === 0) return
      const first = stops[0]
      const last_ = stops[stops.length - 1]
      const active = document.activeElement
      if (event.shiftKey && (active === first || !panel.contains(active))) {
        event.preventDefault()
        last_.focus()
      } else if (!event.shiftKey && active === last_) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [request, cancel])

  /* The page behind must not scroll under the backdrop. `scrollbar-gutter` is
     already stable app-wide, so removing the bar here costs no layout shift. */
  useEffect(() => {
    if (!request) return undefined
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [request])

  if (!mounted || !shown) return null

  const leaving = request === null
  const danger = shown.tone === 'danger'
  const titleId = `confirm-title-${shown.id}`
  const bodyId = `confirm-body-${shown.id}`

  return (
    <div
      className="mila-dialog-backdrop fixed inset-0 z-[200] flex items-center justify-center p-4"
      data-leaving={leaving ? 'true' : undefined}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) cancel()
      }}
    >
      <div
        ref={panelRef}
        /* `alertdialog`, not `dialog`: this interrupts to demand an answer, and
           the role makes a screen reader read the body out on arrival rather
           than waiting to be explored. */
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={shown.body ? bodyId : undefined}
        data-leaving={leaving ? 'true' : undefined}
        /* Nearly opaque, unlike the toast's `bg-white/85`. The toast floats
           over the page; this floats over a dark scrim, and at 90% the scrim
           came through enough to turn the panel a muddy lavender-grey — the
           top-most surface on screen reading as the dullest. */
        className="mila-dialog w-full max-w-md rounded-2xl border border-white/70 bg-white/97 p-6 text-center shadow-[0_24px_60px_rgba(63,47,107,0.28)] backdrop-blur-xl"
      >
        {/* Centred on one axis rather than split into an icon rail and a text
            column. Side-by-side left the gutter under the icon empty, so the
            title and body started well inside the panel while the buttons ran
            out to its full width — three different left edges on a box with
            four things in it. On one axis every element shares the panel's
            padding, and the gaps between them are the only spacing left to
            get right. */}
        {danger && (
          /* A tinted disc, matching the toast — MILA marks type with a disc or
             a pill, never a bar down one edge. */
          <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-red-600">
            <TriangleAlert className="h-6 w-6" />
          </span>
        )}

        <h2 id={titleId} className="text-lg font-semibold leading-snug text-slate-900">
          {shown.title}
        </h2>

        {shown.body && (
          <p id={bodyId} className="mt-2 text-sm leading-relaxed text-slate-600">
            {shown.body}
          </p>
        )}

        {phrase && (
          <label className="mt-5 block">
            <span className="mb-1.5 block text-sm font-medium text-slate-700">
              Type <span className="font-mono font-semibold text-slate-900">{phrase}</span> to
              confirm
            </span>
            <input
              data-confirm-phrase
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && canConfirm) onSettle(shown.id, true)
              }}
              autoComplete="off"
              spellCheck={false}
              className={`${FIELD_CLASS} text-center`}
            />
          </label>
        )}

        {/* Equal halves. Two buttons of different widths on a centred panel
            re-introduce exactly the lopsidedness the layout above removes, and
            sizing them by their labels would make "Delete permanently" tower
            over "Cancel". */}
        <div className="mt-6 grid grid-cols-2 gap-3">
          <Button data-confirm-cancel block variant="secondary" onClick={cancel}>
            {shown.cancelLabel ?? 'Cancel'}
          </Button>
          <Button
            data-confirm-accept
            block
            variant={danger ? 'danger' : 'primary'}
            disabled={!canConfirm}
            /* The design system fades a disabled button to `opacity: .55`,
               which on a red fill just reads as a paler red — an armed button,
               not a shut one. That is precisely wrong here: the whole point of
               the phrase gate is that the button is visibly locked until it is
               earned. Greyed while shut, red the moment the phrase matches, so
               the colour arriving *is* the feedback.

               `!` on every one of these: the design system injects its CSS as a
               plain `<style>` in the head, and an unlayered rule beats anything
               in Tailwind v4's `@layer utilities` no matter how specific. The
               unprefixed classes were emitted and simply lost the cascade. */
            className="disabled:!bg-slate-200 disabled:!text-slate-500 disabled:!opacity-100 disabled:!shadow-none"
            onClick={() => onSettle(shown.id, true)}
          >
            {shown.confirmLabel ?? 'Confirm'}
          </Button>
        </div>
      </div>
    </div>
  )
}

/**
 * Mounted once, at the app root. Everything else talks to it through
 * `confirm()`.
 */
export function ConfirmHost() {
  const request = useSyncExternalStore(subscribeConfirm, getConfirmRequest, getConfirmRequest)
  return <ConfirmDialog request={request} onSettle={settleConfirm} />
}
