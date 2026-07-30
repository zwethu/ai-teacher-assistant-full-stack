// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { STREAM_STALL_MS, createStallWatchdog } from './streamStallWatchdog'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

function handlers() {
  return { onStall: vi.fn(), onRecover: vi.fn() }
}

describe('stream stall watchdog', () => {
  it('never stalls a healthy long-running stream', () => {
    // The defect this guards: a flat 10s timer that nothing reset meant a 60s run
    // polled the messages endpoint ~10 times while the stream was working fine.
    const watchdog = createStallWatchdog()
    const h = handlers()

    for (let elapsed = 0; elapsed < 60_000; elapsed += 2_000) {
      watchdog.alive('run-1', h)
      vi.advanceTimersByTime(2_000)
    }

    expect(h.onStall).not.toHaveBeenCalled()
    expect(watchdog.isStalled('run-1')).toBe(false)
  })

  it('stalls once the channel actually goes quiet', () => {
    const watchdog = createStallWatchdog()
    const h = handlers()

    watchdog.alive('run-1', h)
    vi.advanceTimersByTime(STREAM_STALL_MS - 1)
    expect(h.onStall).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(h.onStall).toHaveBeenCalledTimes(1)
    expect(watchdog.isStalled('run-1')).toBe(true)
  })

  it('recovers when the stream resumes, and only then', () => {
    const watchdog = createStallWatchdog()
    const h = handlers()

    watchdog.alive('run-1', h)
    vi.advanceTimersByTime(STREAM_STALL_MS)
    expect(h.onStall).toHaveBeenCalledTimes(1)

    watchdog.alive('run-1', h)
    expect(h.onRecover).toHaveBeenCalledTimes(1)
    expect(watchdog.isStalled('run-1')).toBe(false)

    // A second signal on a healthy stream is not another recovery.
    watchdog.alive('run-1', h)
    expect(h.onRecover).toHaveBeenCalledTimes(1)
  })

  it('tracks runs independently', () => {
    // useChatPage previously kept one shared timer, so two concurrent runs fought
    // over the same slot and one of them lost its fallback entirely.
    const watchdog = createStallWatchdog()
    const quiet = handlers()
    const busy = handlers()

    watchdog.alive('quiet-run', quiet)
    for (let elapsed = 0; elapsed < STREAM_STALL_MS * 2; elapsed += 2_000) {
      watchdog.alive('busy-run', busy)
      vi.advanceTimersByTime(2_000)
    }

    expect(quiet.onStall).toHaveBeenCalledTimes(1)
    expect(busy.onStall).not.toHaveBeenCalled()
  })

  it('clear() stops a pending deadline', () => {
    const watchdog = createStallWatchdog()
    const h = handlers()

    watchdog.alive('run-1', h)
    watchdog.clear('run-1')
    vi.advanceTimersByTime(STREAM_STALL_MS * 3)

    expect(h.onStall).not.toHaveBeenCalled()
  })

  it('clear() with no argument stops every run, for unmount', () => {
    const watchdog = createStallWatchdog()
    const a = handlers()
    const b = handlers()

    watchdog.alive('run-a', a)
    watchdog.alive('run-b', b)
    watchdog.clear()
    vi.advanceTimersByTime(STREAM_STALL_MS * 3)

    expect(a.onStall).not.toHaveBeenCalled()
    expect(b.onStall).not.toHaveBeenCalled()
  })
})
