import { useSyncExternalStore } from 'react'
import { Undo2, X } from 'lucide-react'

import { usePresenceList } from '../../hooks/usePresenceList'
import {
  commitNow,
  getUndoEntries,
  subscribeUndo,
  undo,
  type UndoEntry,
} from './undoStore'

/**
 * "Deleted. Undo" — with the clock showing.
 *
 * The counterpart to `ConfirmDialog`, and the one that should be reached for
 * first: this is what lets a delete happen on one click without gambling
 * anything. It reuses the toast's shell deliberately, because it *is* the
 * confirmation of the action — the call sites that used to fire a separate
 * "File deleted." toast no longer do, or the two would stack in the same
 * corner saying the same thing.
 *
 * **The ring is not decoration.** A second chance the lecturer cannot time is
 * a second chance they will not use; the draining ring says how long is left
 * without spending a word on it.
 */

/** Must match `.mila-undo[data-leaving]` in index.css. */
const UNDO_EXIT_MS = 160

/**
 * A ring that empties over the life of the window.
 *
 * `pathLength="1"` renormalises the circle's geometry to a single unit, so the
 * dash offset animates 0 → 1 regardless of the radius and nothing has to
 * compute a circumference.
 */
function CountdownRing({ ms }: { ms: number }) {
  return (
    <svg viewBox="0 0 24 24" className="mila-undo__ring h-7 w-7" aria-hidden="true">
      <circle cx="12" cy="12" r="10" fill="none" strokeWidth="2.5" className="text-violet-100" stroke="currentColor" />
      <circle
        cx="12"
        cy="12"
        r="10"
        fill="none"
        strokeWidth="2.5"
        strokeLinecap="round"
        pathLength="1"
        className="mila-undo__drain text-violet-600"
        stroke="currentColor"
        style={{ animationDuration: `${ms}ms` }}
      />
    </svg>
  )
}

function UndoRow({ entry, leaving }: { entry: UndoEntry; leaving: boolean }) {
  return (
    <div
      /* `status`, not `alert`: the deletion already happened and the lecturer
         asked for it. Interrupting them to announce their own click is noise —
         but it still has to be announced, because the undo is time-limited. */
      role="status"
      data-leaving={leaving ? 'true' : undefined}
      className="mila-undo pointer-events-auto flex w-full max-w-sm items-center gap-3 rounded-2xl border border-white/60 bg-white/85 p-3 pr-2.5 shadow-[0_14px_34px_rgba(63,47,107,0.18)] backdrop-blur-xl"
    >
      <span className="flex flex-shrink-0 items-center justify-center">
        <CountdownRing ms={entry.ms} />
      </span>
      <p className="min-w-0 flex-1 text-sm font-medium leading-snug text-slate-700">
        {entry.message}
      </p>
      <button
        type="button"
        onClick={() => undo(entry.id)}
        className="flex flex-shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-semibold text-violet-700 transition-colors hover:bg-violet-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
      >
        <Undo2 className="h-4 w-4" />
        Undo
      </button>
      <button
        type="button"
        /* Dismiss means "yes, I meant it" — waiting out a timer for something
           you are sure about is its own small annoyance, so this commits now
           rather than merely hiding the toast and leaving the delete pending. */
        onClick={() => commitNow(entry.id)}
        aria-label="Dismiss and delete now"
        className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}

/** Mounted once, at the app root. */
export function UndoHost() {
  const entries = useSyncExternalStore(subscribeUndo, getUndoEntries, getUndoEntries)
  /* Keyed on the scheduling, not the id: deleting the same row twice in a row
     has to restart the ring, and a reused key would leave the old animation
     running out. */
  const rows = usePresenceList(entries, (entry) => String(entry.key), UNDO_EXIT_MS)

  if (rows.length === 0) return null

  return (
    <div className="pointer-events-none fixed inset-x-4 bottom-6 z-[150] flex flex-col items-end gap-2 sm:inset-x-auto sm:right-6">
      {rows.map(({ item, leaving }) => (
        <UndoRow key={item.key} entry={item} leaving={leaving} />
      ))}
    </div>
  )
}
