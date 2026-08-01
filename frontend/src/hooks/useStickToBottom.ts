import { useEffect, useRef, type RefObject } from 'react'

/**
 * How close to the bottom still counts as "following along". Generous enough
 * that a small nudge of the wheel does not detach the transcript mid-answer.
 */
export const STICK_TO_BOTTOM_PX = 120

/**
 * Keep a transcript pinned to its bottom while its content grows.
 *
 * Driven by the *content's size*, not by the event stream. The run used to
 * scroll on every RTDB event, which meant a step row easing its height open
 * over 300ms grew the page while nothing scrolled — and then the next event
 * snapped it down. Smooth, smooth, jerk. A ResizeObserver fires on every frame
 * the content actually changes size, so the scroll tracks the animation rather
 * than catching up after it.
 *
 * It also only pins when the lecturer is already at the bottom. The old
 * event-driven scroll was unconditional, so reading back through a
 * conversation during a live run yanked them to the end every time a token
 * arrived — and with paging, scrolling up to *load* earlier messages would
 * have fought the load itself.
 */
export function useStickToBottom(
  scrollRef: RefObject<HTMLElement | null>,
  contentRef: RefObject<HTMLElement | null>,
) {
  // Starts pinned: a freshly opened conversation should land at its most
  // recent message, and nothing has scrolled yet to say otherwise.
  const pinned = useRef(true)

  useEffect(() => {
    const el = scrollRef.current
    const content = contentRef.current
    if (!el || !content) return undefined
    // Baseline in every browser this app supports; absent in jsdom, where a
    // component test that happens to mount the transcript would otherwise
    // throw on an enhancement it is not testing.
    if (typeof ResizeObserver === 'undefined') return undefined

    const measure = () => {
      pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight <= STICK_TO_BOTTOM_PX
    }
    el.addEventListener('scroll', measure, { passive: true })

    // Writing scrollTop does not change the observed element's size, so this
    // cannot feed itself a second resize.
    const observer = new ResizeObserver(() => {
      if (pinned.current) el.scrollTop = el.scrollHeight
    })
    observer.observe(content)

    return () => {
      el.removeEventListener('scroll', measure)
      observer.disconnect()
    }
  }, [scrollRef, contentRef])
}
