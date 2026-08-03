/**
 * `window.confirm`, replaced.
 *
 * **Why an imperative store and not a component.** Five of the app's
 * confirmations live inside `useBatchesPage.ts` — a hook, which cannot render a
 * dialog — and every call site is written as `if (!window.confirm(…)) return`.
 * A `<ConfirmDialog open={…}>` per site would mean hoisting state into nine
 * files and inverting control flow in all sixteen. A promise keeps the code
 * shaped the way it already reads:
 *
 * ```ts
 * if (!(await confirm({ title: 'Delete this?' }))) return
 * ```
 *
 * The store lives outside React so it can be called from anywhere; a single
 * `<ConfirmHost />` at the app root subscribes and draws the result.
 *
 * **Confirmations are the exception here, not the rule.** Per the undo
 * checklist in `ui-component-patterns`, a reversible action should just happen
 * and offer `undoable()` instead. This is for the two cases that survive that
 * test: something genuinely irreversible (`confirmPhrase`), and something with
 * no undoable state to hold on to (signing out, discarding a draft).
 */

export type ConfirmTone = 'danger' | 'neutral'

export type ConfirmOptions = {
  /** The question. Shown as the dialog's title, so it should end in "?". */
  title: string
  /** The consequence. This is the half `window.confirm` rendered as one grey blob. */
  body?: string
  confirmLabel?: string
  cancelLabel?: string
  /** `danger` paints the confirm button red. Defaults to `neutral`. */
  tone?: ConfirmTone
  /**
   * Require this exact text to be typed before confirming — GitHub's
   * repository-deletion gate. Only for actions with no way back.
   */
  confirmPhrase?: string
}

export type ConfirmRequest = ConfirmOptions & {
  id: number
  resolve: (confirmed: boolean) => void
}

let current: ConfirmRequest | null = null
let nextId = 1
const listeners = new Set<() => void>()

function emit() {
  for (const listener of listeners) listener()
}

/**
 * Ask, and resolve to what the lecturer chose.
 *
 * Never rejects — a cancel is `false`, not an error, because every call site
 * treats it as an early return rather than something to catch.
 */
export function confirm(options: ConfirmOptions): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    /* Two dialogs can't share one screen, and the second is the one the
       lecturer just asked for. Answering the first "no" is the safe direction:
       whatever it was guarding does not happen. */
    if (current) {
      const stale = current
      current = null
      stale.resolve(false)
    }
    current = { ...options, id: nextId++, resolve }
    emit()
  })
}

/** Called by the host when a button is pressed. Ignores a stale id. */
export function settleConfirm(id: number, confirmed: boolean) {
  if (!current || current.id !== id) return
  const request = current
  current = null
  emit()
  request.resolve(confirmed)
}

export function subscribeConfirm(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getConfirmRequest(): ConfirmRequest | null {
  return current
}

/** Tests only — drops any open request without resolving it. */
export function resetConfirmStore() {
  current = null
  nextId = 1
  listeners.clear()
}
