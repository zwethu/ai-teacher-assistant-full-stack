import { useRef } from 'react'
import { Check, TriangleAlert, X } from 'lucide-react'

import { useExitDelay } from '../../hooks/useExitDelay'
import type { ToastMessage } from '../../types'

/**
 * App toast.
 *
 * Rewritten here rather than by editing `design-system/components/feedback/
 * Toast.jsx`, which is vendored from the upstream design project and would be
 * overwritten on the next sync. Three things were wrong with it:
 *
 *  · **A 4px coloured `border-left`.** The default treatment for a status
 *    strip, and on a glass surface the one detail that made it read as a
 *    library component dropped into the app rather than a part of it. Nothing
 *    else in MILA marks type with a bar down one edge — artifact rows, file
 *    chips and step badges all use a tinted disc or pill. So does this now.
 *
 *  · **It entered from above** (`translateY(-8px)`) while anchored to the
 *    bottom-right corner, so it slid *down* into a corner it had risen from
 *    nowhere to reach. It comes up out of that edge now.
 *
 *  · **It had no exit.** The old one was unmounted the instant its state went
 *    null, so after five seconds of sitting there it simply blinked out.
 *
 * The props are unchanged, so none of the six call sites move.
 */

/** Must match `.mila-toast[data-leaving]` in index.css. */
const TOAST_EXIT_MS = 180

const TONE = {
  success: {
    disc: 'bg-emerald-100 text-emerald-700',
    Icon: Check,
    // Success is the one thing a lecturer can safely miss.
    role: 'status' as const,
  },
  error: {
    disc: 'bg-red-100 text-red-700',
    Icon: TriangleAlert,
    // A failure has to interrupt, or it is announced to nobody.
    role: 'alert' as const,
  },
}

interface ToastProps {
  toast: ToastMessage | null
  onDismiss: () => void
}

export default function Toast({ toast, onDismiss }: ToastProps) {
  const mounted = useExitDelay(toast !== null, TOAST_EXIT_MS)
  /* The last non-null toast, so the message survives its own dismissal — by
     the time it is leaving, `toast` is already null and there would be nothing
     left to draw. Written during render rather than in an effect: the value is
     needed on the very render where `toast` goes null, and an effect runs a
     frame too late, which would blank the text before it faded. */
  const last = useRef<ToastMessage | null>(null)
  if (toast) last.current = toast

  const shown = last.current
  if (!mounted || !shown) return null
  const { disc, Icon, role } = TONE[shown.type] ?? TONE.success

  return (
    <div className="pointer-events-none fixed inset-x-4 bottom-6 z-[100] flex justify-end sm:inset-x-auto sm:right-6">
      <div
        role={role}
        data-leaving={toast ? undefined : 'true'}
        /* The app's own floating plane — the glass, radius and low diffuse
           shadow the composer already uses, so a toast reads as another thing
           hovering over this page rather than as another system's chrome. */
        className="mila-toast pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-2xl border border-white/60 bg-white/85 p-3 pr-2.5 shadow-[0_14px_34px_rgba(63,47,107,0.18)] backdrop-blur-xl"
      >
        {/* A tinted disc, not a bar down the edge. Emerald stays MILA's one
            role for success; red carries the failure. */}
        <span
          className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full ${disc}`}
        >
          <Icon className="h-4 w-4" />
        </span>
        <p className="min-w-0 flex-1 pt-1 text-sm font-medium leading-snug text-slate-700">
          {shown.message}
        </p>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
