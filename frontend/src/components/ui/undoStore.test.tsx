// @vitest-environment jsdom

import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { commitNow, resetUndoStore, undo, undoable, usePendingUndo } from './undoStore'

afterEach(() => {
  cleanup()
  resetUndoStore()
  vi.useRealTimers()
})

beforeEach(() => {
  vi.useFakeTimers()
})

/** Reads the hook without needing a page. */
function Probe({ onRead }: { onRead: (ids: Set<string>) => void }) {
  onRead(usePendingUndo())
  return null
}

describe('undoable()', () => {
  /**
   * The point of deferring rather than deleting-then-restoring: undo is not a
   * second API call that has to succeed, it is the absence of the first one.
   * Nothing was ever deleted, so nothing can fail to come back.
   */
  it('holds the delete for the window, then commits', () => {
    const commit = vi.fn()
    undoable({ id: 'f1', message: 'Deleted.', commit, ms: 10_000 })

    act(() => {
      vi.advanceTimersByTime(9_999)
    })
    expect(commit).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(commit).toHaveBeenCalledTimes(1)
  })

  it('never commits once it is taken back', () => {
    const commit = vi.fn()
    const onUndo = vi.fn()
    undoable({ id: 'f1', message: 'Deleted.', commit, onUndo, ms: 10_000 })

    act(() => {
      undo('f1')
    })
    expect(onUndo).toHaveBeenCalledTimes(1)

    act(() => {
      vi.advanceTimersByTime(60_000)
    })
    expect(commit).not.toHaveBeenCalled()
  })

  /**
   * Dismissing the toast means "yes, I meant it". Waiting out a timer for
   * something you are already sure about is its own small annoyance.
   */
  it('commits immediately when dismissed', () => {
    const commit = vi.fn()
    undoable({ id: 'f1', message: 'Deleted.', commit, ms: 10_000 })

    act(() => {
      commitNow('f1')
    })
    expect(commit).toHaveBeenCalledTimes(1)

    // And not a second time when the original deadline comes round.
    act(() => {
      vi.advanceTimersByTime(60_000)
    })
    expect(commit).toHaveBeenCalledTimes(1)
  })

  /**
   * What makes the row vanish. Pages filter by this set rather than splicing
   * their own arrays, which is also why an undone row lands back in its
   * original position rather than at the end of the list.
   */
  it('hides the row for the length of the window and no longer', () => {
    let ids = new Set<string>()
    render(<Probe onRead={(next) => { ids = next }} />)

    expect(ids.has('f1')).toBe(false)
    act(() => {
      undoable({ id: 'f1', message: 'Deleted.', commit: vi.fn(), ms: 10_000 })
    })
    expect(ids.has('f1')).toBe(true)

    act(() => {
      vi.advanceTimersByTime(10_000)
    })
    expect(ids.has('f1')).toBe(false)
  })

  it('puts the row back the moment it is undone', () => {
    let ids = new Set<string>()
    render(<Probe onRead={(next) => { ids = next }} />)

    act(() => {
      undoable({ id: 'f1', message: 'Deleted.', commit: vi.fn(), ms: 10_000 })
    })
    act(() => {
      undo('f1')
    })
    expect(ids.has('f1')).toBe(false)
  })

  /**
   * A failed commit must not leave the row hidden. The window has already
   * closed by the time the request goes out, so the row is back on screen —
   * the caller's `onError` only has to say what went wrong.
   */
  it('reports a commit that fails, with the row already restored', async () => {
    const onError = vi.fn()
    let ids = new Set<string>()
    render(<Probe onRead={(next) => { ids = next }} />)

    act(() => {
      undoable({
        id: 'f1',
        message: 'Deleted.',
        commit: () => Promise.reject(new Error('offline')),
        onError,
        ms: 10_000,
      })
    })
    await act(async () => {
      vi.advanceTimersByTime(10_000)
    })

    expect(ids.has('f1')).toBe(false)
    expect(onError).toHaveBeenCalledTimes(1)
  })

  /**
   * The timers deliberately live in the module rather than in a hook. A
   * lecturer who deletes a file and immediately navigates away must still have
   * the file deleted; a timer owned by the page would be cleared on unmount
   * and the deletion would be silently lost.
   */
  it('still commits after the page that scheduled it unmounts', () => {
    const commit = vi.fn()
    const view = render(<Probe onRead={() => {}} />)

    act(() => {
      undoable({ id: 'f1', message: 'Deleted.', commit, ms: 10_000 })
    })
    view.unmount()

    act(() => {
      vi.advanceTimersByTime(10_000)
    })
    expect(commit).toHaveBeenCalledTimes(1)
  })

  /**
   * The abandoned timer.
   *
   * Undoing removes the entry but the timer it armed is still out there, and
   * without an explicit `clearTimeout` it wakes at the original deadline, finds
   * whatever now sits under that id, and commits *that* — so deleting the same
   * row again gets a window cut short by however long the first one had left.
   * The map lookup alone does not catch it: there is an entry there, just not
   * the one the timer was for.
   */
  it('does not let a cancelled window cut short a later one', () => {
    const second = vi.fn()
    undoable({ id: 'f1', message: 'Deleted.', commit: vi.fn(), ms: 10_000 })
    act(() => {
      undo('f1')
    })

    act(() => {
      vi.advanceTimersByTime(5_000)
    })
    undoable({ id: 'f1', message: 'Deleted.', commit: second, ms: 10_000 })

    // The first window's deadline. The second one has 5s left to run.
    act(() => {
      vi.advanceTimersByTime(5_000)
    })
    expect(second).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(5_000)
    })
    expect(second).toHaveBeenCalledTimes(1)
  })

  /** Re-deleting something already on its way out must not commit it twice. */
  it('lets a repeat request replace the one in flight', () => {
    const first = vi.fn()
    const second = vi.fn()
    undoable({ id: 'f1', message: 'Deleted.', commit: first, ms: 10_000 })
    undoable({ id: 'f1', message: 'Deleted.', commit: second, ms: 10_000 })

    act(() => {
      vi.advanceTimersByTime(60_000)
    })
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })
})
