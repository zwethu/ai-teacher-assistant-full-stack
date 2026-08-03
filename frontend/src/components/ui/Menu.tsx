import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { MoreHorizontal } from 'lucide-react'

import { useExitDelay } from '../../hooks/useExitDelay'

/**
 * The app's `⋯` menu.
 *
 * Both menus that existed before this were hand-rolled, and between them they
 * had every failure the dropdown checklist warns about:
 *
 *  · **Clipped.** The chat rows sit in a card with `overflow-hidden`, so the
 *    last row's menu was cut off at the card's edge — one visible item and the
 *    rest gone. An absolutely-positioned panel cannot escape a clipping
 *    ancestor at all, which is why this one renders in a portal.
 *
 *  · **Painted under the page.** `z-20` inside a row that establishes its own
 *    stacking context put the panel *behind* the rows below it, so the next
 *    chat's timestamp showed through the word "Delete". It looked like the menu
 *    was translucent; it was underneath.
 *
 *  · **No flip.** It always opened downward, whether or not there was room.
 *
 *  · **Too small to aim at.** 12px labels in 22px rows, from a 22px trigger.
 *
 *  · **No keyboard.** No arrows, no Escape, no focus return.
 *
 * The panel is `position: fixed` off the trigger's rect rather than absolute
 * inside it — the same reason as the portal. That means re-measuring on scroll
 * and resize, which is cheap and only runs while the menu is open.
 */

/** Must match `.mila-menu[data-leaving]` in index.css. */
const MENU_EXIT_MS = 140
/** Gap between the trigger and the panel. */
const GAP = 6
/** Breathing room kept between the panel and the edge of the viewport. */
const MARGIN = 8
/** Only for the frame before the panel has been laid out and measured. */
const PANEL_H_FALLBACK = 280

type MenuContext = { close: (restoreFocus?: boolean) => void }
const Ctx = createContext<MenuContext>({ close: () => {} })

type Position = { top: number; left: number; dropUp: boolean; maxHeight?: number }

export function Menu({
  children,
  label,
  /** Which edge of the panel lines up with the trigger. */
  align = 'right',
  width = 'w-56',
  trigger,
  triggerClassName = '',
  onOpenChange,
}: {
  children: ReactNode
  label: string
  align?: 'left' | 'right'
  width?: string
  /** Defaults to the `⋯` glyph. */
  trigger?: ReactNode
  triggerClassName?: string
  onOpenChange?: (open: boolean) => void
}) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<Position | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const mounted = useExitDelay(open, MENU_EXIT_MS)
  const panelId = useId()

  const setOpenState = useCallback(
    (next: boolean) => {
      setOpen(next)
      onOpenChange?.(next)
    },
    [onOpenChange],
  )

  const close = useCallback(
    (restoreFocus = true) => {
      setOpenState(false)
      if (restoreFocus) triggerRef.current?.focus()
    },
    [setOpenState],
  )

  const measure = useCallback(() => {
    const button = triggerRef.current
    const panel = panelRef.current
    if (!button || !panel) return
    const box = button.getBoundingClientRect()
    /* `scrollHeight`, not `offsetHeight`: once a previous pass has capped the
       panel, its offset height *is* the cap, and measuring that would keep it
       capped for as long as it stayed open. */
    const wanted = panel.scrollHeight || PANEL_H_FALLBACK
    const below = window.innerHeight - box.bottom - GAP - MARGIN
    const above = box.top - GAP - MARGIN
    // Only flip when there is genuinely more room the other way — a panel that
    // fits below should stay below even if above is roomier.
    const dropUp = wanted > below && above > below
    const room = dropUp ? above : below
    const height = Math.min(wanted, room)

    const width_ = panel.offsetWidth
    let left = align === 'right' ? box.right - width_ : box.left
    left = Math.min(Math.max(left, MARGIN), window.innerWidth - width_ - MARGIN)

    setPos({
      top: dropUp ? box.top - GAP - height : box.bottom + GAP,
      left,
      dropUp,
      maxHeight: wanted > room ? height : undefined,
    })
  }, [align])

  /* Before paint, so the panel never shows for a frame at the top-left corner
     on its way to where it belongs. */
  useLayoutEffect(() => {
    if (!open) return undefined
    measure()
    // Passive and on capture: a menu anchored to a row has to follow that row
    // when any ancestor scrolls, not only the window.
    window.addEventListener('scroll', measure, { passive: true, capture: true })
    window.addEventListener('resize', measure)
    return () => {
      window.removeEventListener('scroll', measure, { capture: true })
      window.removeEventListener('resize', measure)
    }
  }, [open, measure])

  /* Focus the first item — but only once the panel has been placed. It is
     rendered `visibility: hidden` until then so it never flashes at the corner
     of the screen, and a hidden element cannot take focus: focusing in the
     same commit as the measurement silently did nothing, which left Escape and
     the arrow keys dead because the handler lives on the panel. */
  useEffect(() => {
    if (!open || !pos) return
    const first = panelRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')
    first?.focus()
  }, [open, pos !== null])

  useEffect(() => {
    if (!open) return undefined
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return
      close(false)
    }
    /* Escape is bound to the document rather than only to the panel. A pointer
       user's focus never enters the menu, so a panel-scoped handler left them
       with no key that dismissed it. */
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      close()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, close])

  const onPanelKeyDown = (event: React.KeyboardEvent) => {
    // Tab out closes rather than leaving a menu hanging over the page.
    if (event.key === 'Tab') {
      close(false)
      return
    }
    const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End']
    if (!keys.includes(event.key)) return
    event.preventDefault()
    const items = [
      ...(panelRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ??
        []),
    ]
    if (items.length === 0) return
    const at = items.indexOf(document.activeElement as HTMLElement)
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? items.length - 1
          : event.key === 'ArrowDown'
            ? (at + 1) % items.length
            : (at - 1 + items.length) % items.length
    items[next]?.focus()
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => (open ? close() : setOpenState(true))}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            setOpenState(true)
          }
        }}
        /* 36px, up from the 22px both call sites used. Small enough to sit in a
           dense row, big enough to be a target rather than a dare. */
        className={`inline-flex h-9 w-9 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 ${triggerClassName}`}
      >
        {trigger ?? <MoreHorizontal className="h-4 w-4" />}
      </button>

      {mounted &&
        createPortal(
          <div
            ref={panelRef}
            id={panelId}
            role="menu"
            aria-label={label}
            data-leaving={open ? undefined : 'true'}
            data-placement={pos?.dropUp ? 'top' : 'bottom'}
            onKeyDown={onPanelKeyDown}
            style={{
              position: 'fixed',
              top: pos?.top ?? -9999,
              left: pos?.left ?? -9999,
              maxHeight: pos?.maxHeight,
              // Hidden until measured, rather than flashing at the corner.
              visibility: pos ? undefined : 'hidden',
            }}
            className={`mila-menu ${width} z-[300] overflow-y-auto overflow-x-hidden rounded-xl border border-slate-200 bg-white py-1.5 shadow-[0_16px_40px_rgba(63,47,107,0.18)]`}
          >
            <Ctx.Provider value={{ close }}>{children}</Ctx.Provider>
          </div>,
          document.body,
        )}
    </>
  )
}

export function MenuItem({
  children,
  icon,
  onSelect,
  disabled = false,
  danger = false,
  /** Keeps the menu open — for an item that shows progress in place. */
  keepOpen = false,
}: {
  children: ReactNode
  icon?: ReactNode
  /** Receives `close`, so an async item can dismiss itself when it finishes. */
  onSelect: (close: () => void) => void
  disabled?: boolean
  danger?: boolean
  keepOpen?: boolean
}) {
  const { close } = useContext(Ctx)
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={() => {
        onSelect(() => close(false))
        if (!keepOpen) close(false)
      }}
      /* 14px in a 38px row, from 12px in a 22px one. Menu items are the one
         place in the app where the label *is* the target. */
      className={`flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-sm font-medium transition-colors focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 ${
        danger
          ? 'text-red-600 hover:bg-red-50 focus-visible:bg-red-50'
          : 'text-slate-700 hover:bg-violet-50 hover:text-violet-900 focus-visible:bg-violet-50 focus-visible:text-violet-900'
      }`}
    >
      {icon && <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center">{icon}</span>}
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </button>
  )
}

export function MenuSeparator() {
  return <div role="separator" className="my-1.5 border-t border-slate-100" />
}

/** A non-interactive line at the top of a menu — "Last updated", and the like. */
export function MenuHeader({ children }: { children: ReactNode }) {
  return <div className="px-3.5 pb-1.5 pt-1">{children}</div>
}
