import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react'

/**
 * Reading a conversation backwards.
 *
 * Two halves of one behaviour, kept together because they are only correct
 * together: one asks for the page above when the lecturer nears the top, the
 * other stops that page from shoving the screen out from under them.
 */

/** How close to the top counts as "at the top". Roughly a screen of runway, so
 *  the next page is usually already in by the time they reach the end of this
 *  one and the scroll never visibly stops. */
export const LOAD_EARLIER_THRESHOLD_PX = 400

type PagingOptions = { enabled: boolean; busy: boolean; onLoad?: () => void }

function useLoadAtEdge(
  ref: RefObject<HTMLElement | null>,
  { enabled, busy, onLoad }: PagingOptions,
  distanceToEdge: (el: HTMLElement) => number,
) {
  // Read through refs so the listener binds once. Re-binding it on every
  // `busy` flip would drop scroll events in the gap, which is precisely when
  // they matter — the lecturer is mid-flick.
  const state = useRef({ enabled, busy, onLoad })
  state.current = { enabled, busy, onLoad }

  useEffect(() => {
    const el = ref.current
    if (!el) return undefined

    let frame = 0
    const check = () => {
      frame = 0
      const { enabled: on, busy: loading, onLoad: load } = state.current
      if (!on || loading) return
      if (distanceToEdge(el) <= LOAD_EARLIER_THRESHOLD_PX) load?.()
    }
    const onScroll = () => {
      // Scroll fires far faster than a page can load; one check per frame is
      // enough, and the in-flight guard upstream catches the rest.
      if (!frame) frame = requestAnimationFrame(check)
    }

    el.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      el.removeEventListener('scroll', onScroll)
      if (frame) cancelAnimationFrame(frame)
    }
    // `distanceToEdge` is a module-level function at both call sites, so it is
    // stable and deliberately not a dependency.
  }, [ref])
}

/** Older messages live above: page when nearing the top of the transcript. */
export function useLoadEarlierOnScrollTop(ref: RefObject<HTMLElement | null>, options: PagingOptions) {
  useLoadAtEdge(ref, options, (el) => el.scrollTop)
}

/** Older chats live below: the sidebar is newest-first, so page at the bottom.
 *  No anchoring needed — appending changes nothing above the viewport. */
export function useLoadEarlierOnScrollBottom(ref: RefObject<HTMLElement | null>, options: PagingOptions) {
  useLoadAtEdge(ref, options, (el) => el.scrollHeight - el.scrollTop - el.clientHeight)
}

/**
 * Hold the lecturer's place when content is added *above* them.
 *
 * A scroll container measures from the top, so prepending a page leaves
 * `scrollTop` where it was and everything they were reading slides down the
 * screen by the height of what arrived. The fix is to add that height back.
 *
 * `topId` is the discriminator, not the message count: appending a reply at the
 * bottom also grows the list and the height, and correcting for that would
 * yank the transcript away from the answer being streamed. Only a change at
 * the *first* message means content landed above.
 *
 * In a layout effect, so the correction is applied in the same frame the new
 * page is laid out — in a plain effect the jump paints first and the fix reads
 * as a flinch.
 */
export function useScrollAnchor(ref: RefObject<HTMLElement | null>, topId: string | undefined) {
  const previous = useRef<{ topId: string | undefined; height: number }>({
    topId: undefined,
    height: 0,
  })

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const prepended = topId !== previous.current.topId && previous.current.topId !== undefined
    const grew = el.scrollHeight - previous.current.height
    // `grew` is the net change across the whole commit, which is what we want:
    // the page arriving and the loading row leaving are one render, so this
    // absorbs both at once rather than fighting itself over two frames.
    if (prepended && grew > 0) el.scrollTop += grew
    previous.current = { topId, height: el.scrollHeight }
  })
}
