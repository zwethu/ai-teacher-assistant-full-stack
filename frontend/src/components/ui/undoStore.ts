import { useSyncExternalStore } from 'react'

/**
 * Undo instead of "Are you sure?".
 *
 * A confirmation taxes every correct deletion to catch the rare wrong one.
 * Undo taxes nobody: the row goes immediately, and the mistake gets ten
 * seconds to speak up. Per the undo checklist in `ui-component-patterns`, this
 * is the default treatment for a destructive action, and a dialog is the
 * exception.
 *
 * **Deferred commit, not soft delete.** The doctrine wants a `deleted` flag
 * and a thirty-day trash, but nothing in the backend carries that yet — every
 * delete endpoint hard-deletes and there is no restore. So the undo window
 * lives here instead: the row is hidden the instant it is clicked, and the API
 * call is *held* for the length of the window. Undo simply cancels the timer,
 * and the deletion never happened at all.
 *
 * The known cost, accepted deliberately: closing the tab inside the window
 * means the commit never fires and the row is still there on reload. That is
 * the safe direction to fail in — it keeps data rather than destroying it —
 * and it disappears once the backend can soft-delete for real.
 *
 * **Timers live in this module, not in a hook.** A lecturer who deletes a file
 * and immediately navigates away must still have the file deleted; a timer
 * owned by the page would be cleaned up on unmount and the commit would be
 * lost. Nothing here is torn down by React.
 */

/** Gmail's ten seconds — long enough to notice, short enough not to feel stuck. */
export const UNDO_MS = 10_000

export type UndoOptions = {
  /**
   * Stable key of the thing being removed — the file id, the student id.
   * Pages filter their lists by `usePendingUndo()`, so this is what makes the
   * row disappear without any index bookkeeping.
   */
  id: string
  /** Past tense: the action has already happened as far as the lecturer is concerned. */
  message: string
  /** The real deletion, run only if the window closes untouched. */
  commit: () => void | Promise<void>
  /** Anything the page needs to put right when it is taken back. */
  onUndo?: () => void
  /** A commit that failed — the row is already back by the time this runs. */
  onError?: (error: unknown) => void
  ms?: number
}

export type UndoEntry = {
  id: string
  message: string
  ms: number
  /** Distinguishes one scheduling of an id from the next, so the toast remounts. */
  key: number
}

type Pending = UndoEntry & {
  commit: () => void | Promise<void>
  onUndo?: () => void
  onError?: (error: unknown) => void
  timer: ReturnType<typeof setTimeout>
}

const pending = new Map<string, Pending>()
const listeners = new Set<() => void>()
let nextKey = 1

/* Rebuilt on every change and handed out unchanged in between:
   `useSyncExternalStore` compares snapshots by identity and would loop forever
   on a fresh object per read. */
let idsSnapshot: Set<string> = new Set()
let entriesSnapshot: UndoEntry[] = []

function emit() {
  idsSnapshot = new Set(pending.keys())
  entriesSnapshot = [...pending.values()].map(({ id, message, ms, key }) => ({
    id,
    message,
    ms,
    key,
  }))
  for (const listener of listeners) listener()
}

function drop(id: string) {
  const entry = pending.get(id)
  if (!entry) return null
  clearTimeout(entry.timer)
  pending.delete(id)
  emit()
  return entry
}

/**
 * Hide it now, delete it in ten seconds, and offer the way back in between.
 *
 * The caller does not remove the row itself — `usePendingUndo()` hides it for
 * as long as this is outstanding, which is also what makes undo free: the row
 * reappears because it was never really gone.
 */
export function undoable(options: UndoOptions) {
  const ms = options.ms ?? UNDO_MS
  /* Re-deleting something already on its way out: let the newer request win,
     without committing the older one twice. */
  drop(options.id)

  const timer = setTimeout(() => {
    const entry = pending.get(options.id)
    if (!entry) return
    pending.delete(options.id)
    emit()
    void (async () => {
      try {
        await entry.commit()
      } catch (error) {
        entry.onError?.(error)
      }
    })()
  }, ms)

  pending.set(options.id, {
    id: options.id,
    message: options.message,
    ms,
    key: nextKey++,
    commit: options.commit,
    onUndo: options.onUndo,
    onError: options.onError,
    timer,
  })
  emit()
}

/** Take it back. The commit never runs. */
export function undo(id: string) {
  drop(id)?.onUndo?.()
}

/** "Delete it now" — the lecturer dismissed the toast rather than undoing. */
export function commitNow(id: string) {
  const entry = drop(id)
  if (!entry) return
  void (async () => {
    try {
      await entry.commit()
    } catch (error) {
      entry.onError?.(error)
    }
  })()
}

export function subscribeUndo(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getUndoEntries(): UndoEntry[] {
  return entriesSnapshot
}

function getPendingIds(): Set<string> {
  return idsSnapshot
}

/**
 * The ids currently hidden behind an undo window.
 *
 * Pages filter with this rather than splicing their own arrays, so a restored
 * row lands back in its original position for free:
 *
 * ```ts
 * const pendingUndo = usePendingUndo()
 * files.filter((f) => !pendingUndo.has(f.file_id))
 * ```
 */
export function usePendingUndo(): Set<string> {
  return useSyncExternalStore(subscribeUndo, getPendingIds, getPendingIds)
}

/** Tests only. */
export function resetUndoStore() {
  for (const entry of pending.values()) clearTimeout(entry.timer)
  pending.clear()
  nextKey = 1
  emit()
  listeners.clear()
}
