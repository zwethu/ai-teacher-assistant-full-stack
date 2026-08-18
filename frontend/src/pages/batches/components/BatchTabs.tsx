import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { LucideIcon } from 'lucide-react'

import type { DetailTab } from '../types'

/**
 * The batch page's tab bar.
 *
 * It was four hand-written buttons, each drawing its own `border-b-2`. That
 * makes the active mark *teleport*: it vanishes from one tab and reappears
 * under another with nothing connecting the two, so the eye has to re-find it
 * on every switch. Here one indicator moves, which is the whole point of a
 * shared rail — the bar says where you were and where you are in one gesture.
 *
 * It is also a real tablist now. The buttons carried no roles, no
 * `aria-selected`, no arrow-key navigation and no focus ring at all, so a
 * keyboard user tabbed through four unlabelled buttons with nothing on screen
 * telling them which one they had reached.
 */

export type TabSpec = {
  id: DetailTab
  label: string
  icon: LucideIcon
  /** Omitted when there is no honest number to show — including 0, and
      including "not loaded yet", which must not render as an empty count. */
  badge?: number
  /**
   * What the badge counts, in words: "24 students", "12 weeks planned".
   *
   * A bare number beside a label is readable on screen and ambiguous out loud
   * — "Planning 12" says nothing. This becomes the tab's accessible name, so
   * the pill stays a pill and a screen reader still gets a sentence.
   */
  badgeLabel?: string
}

type Props = {
  tabs: TabSpec[]
  active: DetailTab
  onChange: (id: DetailTab) => void
}

export function BatchTabs({ tabs, active, onChange }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const tabRefs = useRef(new Map<DetailTab, HTMLButtonElement>())
  const [indicator, setIndicator] = useState({ left: 0, width: 0, ready: false })
  const [overflow, setOverflow] = useState({ start: false, end: false })

  /* The indicator is measured from the active tab rather than composed of
     per-tab borders. `offsetLeft` is relative to the scroller's padding box, so
     it needs no scroll correction — the indicator lives inside the same
     scrolling content and travels with it. */
  const measure = useCallback(() => {
    const node = tabRefs.current.get(active)
    if (!node) return
    setIndicator({ left: node.offsetLeft, width: node.offsetWidth, ready: true })
  }, [active])

  useLayoutEffect(measure, [measure])

  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(measure)
    const el = scrollRef.current
    if (el) observer.observe(el)
    return () => observer.disconnect()
  }, [measure])

  /* Edge fades, so an overflowing row says there is more rather than simply
     ending. Only ever shown on the side that actually has content past it. */
  const readOverflow = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    setOverflow({
      start: el.scrollLeft > 4,
      end: el.scrollLeft + el.clientWidth < el.scrollWidth - 4,
    })
  }, [])

  useEffect(() => {
    readOverflow()
    const el = scrollRef.current
    if (!el) return undefined
    el.addEventListener('scroll', readOverflow, { passive: true })
    window.addEventListener('resize', readOverflow)
    return () => {
      el.removeEventListener('scroll', readOverflow)
      window.removeEventListener('resize', readOverflow)
    }
  }, [readOverflow, tabs.length])

  /**
   * Keep the active tab in view — by moving *this* strip's `scrollLeft`, and
   * nothing else.
   *
   * `scrollIntoView` was the obvious call and the wrong one: it scrolls every
   * scrollable ancestor, so switching tabs while the bar sat at one end also
   * nudged the page scroller underneath it and the whole panel appeared to
   * jump. Writing `scrollLeft` on one element cannot reach anything above it.
   */
  useEffect(() => {
    const el = scrollRef.current
    const node = tabRefs.current.get(active)
    if (!el || !node) return
    const left = node.offsetLeft
    const right = left + node.offsetWidth
    // A little past the edge, so the tab does not land flush against it.
    const margin = 12
    let target: number | null = null
    if (left - margin < el.scrollLeft) target = Math.max(0, left - margin)
    else if (right + margin > el.scrollLeft + el.clientWidth) {
      target = right + margin - el.clientWidth
    }
    if (target === null) return

    // jsdom implements `scrollLeft` as a plain property but ships no
    // `scrollTo`, so a component test would throw on the smooth path — an
    // enhancement it is not testing.
    if (typeof el.scrollTo === 'function') el.scrollTo({ left: target, behavior: 'smooth' })
    else el.scrollLeft = target
  }, [active])

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const index = tabs.findIndex((tab) => tab.id === active)
    const moves: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1 }
    let next = -1

    if (event.key in moves) next = (index + moves[event.key] + tabs.length) % tabs.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = tabs.length - 1
    else return

    event.preventDefault()
    // Automatic activation: with four cheap panels this is what WAI-ARIA
    // recommends, and it means arrowing along the bar shows each tab rather
    // than requiring a second keypress to commit.
    onChange(tabs[next].id)
    tabRefs.current.get(tabs[next].id)?.focus()
  }

  return (
    <div className="relative mb-3 shrink-0">
      <div
        ref={scrollRef}
        role="tablist"
        aria-label="Batch sections"
        onKeyDown={handleKeyDown}
        className="mila-tabstrip relative flex gap-1 overflow-x-auto"
      >
        {tabs.map((tab) => {
          const Icon = tab.icon
          const selected = tab.id === active
          const showBadge = tab.badge !== undefined && tab.badge > 0
          return (
            <button
              key={tab.id}
              ref={(node) => {
                if (node) tabRefs.current.set(tab.id, node)
                else tabRefs.current.delete(tab.id)
              }}
              type="button"
              role="tab"
              id={`batch-tab-${tab.id}`}
              aria-selected={selected}
              aria-controls={`batch-panel-${tab.id}`}
              // Roving tabindex: one stop for the whole bar, then arrows.
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(tab.id)}
              aria-label={showBadge ? `${tab.label}, ${tab.badgeLabel ?? tab.badge}` : undefined}
              /* The focus ring is deliberately *not* violet.
                 The active state is a violet underline and violet text, so a
                 violet ring would say the same thing twice and a keyboard user
                 could not tell where they are from what is selected. Slate-800
                 is 12:1 on this surface and unmistakably a different signal.
                 It is the one control in the app whose focus ring is not the
                 brand colour, and that is the reason. */
              className={`relative z-10 flex items-center gap-2 whitespace-nowrap rounded-t-md px-4 py-2.5 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-800 focus-visible:ring-offset-1 ${
                selected ? 'text-violet-700' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
              {showBadge && (
                <span
                  aria-hidden="true"
                  className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-xs tabular-nums transition-colors ${
                    selected ? 'bg-violet-100 text-violet-700' : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  {/* The chat count is fetched against the server's 100-row
                      ceiling, so past that the number is a floor, not a fact.
                      Four tabs of pills also have to stay the same width. */}
                  {(tab.badge as number) > 99 ? '99+' : tab.badge}
                </span>
              )}
            </button>
          )
        })}

        {/* One bar, moved — not four borders switched on and off. Hidden until
            the first measurement so it cannot start at x=0 and slide in from
            under the leftmost tab on mount. */}
        <span
          aria-hidden="true"
          className="mila-tab-indicator absolute bottom-0 h-0.5 rounded-full bg-violet-600"
          style={{
            transform: `translateX(${indicator.left}px)`,
            width: indicator.width,
            opacity: indicator.ready ? 1 : 0,
          }}
        />
      </div>

      {/* Fades rather than chevrons: the row holds four items and only clips on
          a narrow phone, where a chevron is a 44px target competing with the
          tabs themselves for the width that is already short. */}
      <div
        aria-hidden="true"
        className={`pointer-events-none absolute inset-y-0 left-0 w-8 bg-gradient-to-r from-[var(--academic-bg)] to-transparent transition-opacity duration-200 ${
          overflow.start ? 'opacity-100' : 'opacity-0'
        }`}
      />
      <div
        aria-hidden="true"
        className={`pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-[var(--academic-bg)] to-transparent transition-opacity duration-200 ${
          overflow.end ? 'opacity-100' : 'opacity-0'
        }`}
      />
    </div>
  )
}
