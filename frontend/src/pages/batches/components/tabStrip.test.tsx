// @vitest-environment jsdom

import { readFileSync } from 'node:fs'

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BookOpenCheck, MessageCircle, Sparkles, Users } from 'lucide-react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { BatchTabs } from './BatchTabs'
import type { DetailTab } from '../types'

/**
 * The batch tabs grew a vertical scrollbar down their right-hand side — stepper
 * arrows and all — over a single pixel of border.
 *
 * `overflow-x: auto` forces a `visible` `overflow-y` to compute to `auto`
 * (CSS Overflow 3 §3), and `-mb-px` on the tabs (the trick that lays each tab's
 * own underline over the strip's rule) leaves them overhanging their container
 * by exactly 1px. Scrollable axis, scrollbar.
 *
 * jsdom computes no layout, so that half is still checked against the source
 * and the stylesheet. Everything below it is checked against the rendered bar.
 */
/* Read from the project root rather than `import.meta.url`: under jsdom that
   is not a `file://` URL, and `readFileSync` rejects it. Vitest runs from the
   frontend root, so these paths are stable. */
const source = readFileSync('src/pages/batches/components/BatchTabs.tsx', 'utf8')
const css = readFileSync('src/index.css', 'utf8')

/* Comments stripped: these assertions match raw text, so prose *explaining*
   why something was removed reads to them exactly like the thing itself. */
const strip = source
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')

const TABS = [
  { id: 'planning' as DetailTab, label: 'Planning', icon: BookOpenCheck },
  { id: 'students' as DetailTab, label: 'Students', icon: Users },
  { id: 'materials' as DetailTab, label: 'Chats', icon: MessageCircle },
  { id: 'artifacts' as DetailTab, label: 'Generated content', icon: Sparkles, badge: 11 },
]

afterEach(cleanup)

function renderTabs(active: DetailTab = 'materials') {
  const onChange = vi.fn()
  const view = render(<BatchTabs tabs={TABS} active={active} onChange={onChange} />)
  return { ...view, onChange }
}

describe('the batch tab strip', () => {
  it('scrolls sideways without becoming scrollable downwards', () => {
    expect(strip).toContain('overflow-x-auto')
    expect(strip).not.toContain('-mb-px')
  })

  it('draws its rule as an inset shadow, so the tabs need no negative margin', () => {
    expect(strip).toContain('mila-tabstrip')
    expect(css).toMatch(/\.mila-tabstrip\s*\{[^}]*box-shadow:\s*inset 0 -1px 0/)
  })

  /**
   * "Sessions" reads as a login session or a class meeting, neither of which
   * this tab is — and the tab's own copy had already drifted to the honest
   * word. Not "History": the tab is where a chat gets *started*, so naming it
   * for the past would describe half of it.
   */
  it('calls the chat tab what it is', () => {
    renderTabs()
    expect(screen.getByRole('tab', { name: /Chats/ })).toBeTruthy()
    expect(screen.queryByRole('tab', { name: /Sessions/ })).toBeNull()
  })

  /**
   * One bar that moves, rather than four borders switched on and off. The old
   * arrangement made the mark teleport — gone from one tab, back under another,
   * with nothing joining them.
   */
  it('moves a single indicator instead of switching four borders', () => {
    const { container } = renderTabs()
    expect(container.querySelectorAll('.mila-tab-indicator')).toHaveLength(1)
    // No per-tab underline left behind.
    expect(strip).not.toContain('border-b-2')
    expect(css).toMatch(/\.mila-tab-indicator\s*\{[^}]*transition:[^}]*transform/)
    // Both, because the tabs are different widths — a fixed-width bar would
    // sit narrower than the tab it belongs to.
    expect(css).toMatch(/\.mila-tab-indicator\s*\{[^}]*width/)
  })

  it('is a real tablist, not four unlabelled buttons', () => {
    renderTabs()
    const list = screen.getByRole('tablist', { name: 'Batch sections' })
    expect(list).toBeTruthy()

    const selected = screen.getByRole('tab', { selected: true })
    expect(selected.textContent).toContain('Chats')
    expect(selected.getAttribute('aria-controls')).toBe('batch-panel-materials')
  })

  /** One tab stop for the whole bar, then arrows — not four stops. */
  it('rovers its tab stop', () => {
    renderTabs()
    const tabs = screen.getAllByRole('tab')
    const stops = tabs.filter((tab) => tab.getAttribute('tabindex') === '0')
    expect(stops).toHaveLength(1)
    expect(stops[0].textContent).toContain('Chats')
  })

  it('moves between tabs with the arrow keys, and wraps', async () => {
    const user = userEvent.setup()
    const { onChange } = renderTabs('materials')
    screen.getByRole('tab', { selected: true }).focus()

    await user.keyboard('{ArrowRight}')
    expect(onChange).toHaveBeenLastCalledWith('artifacts')

    await user.keyboard('{ArrowLeft}')
    expect(onChange).toHaveBeenLastCalledWith('students')
  })

  it('jumps to the ends with Home and End', async () => {
    const user = userEvent.setup()
    const { onChange } = renderTabs('materials')
    screen.getByRole('tab', { selected: true }).focus()

    await user.keyboard('{Home}')
    expect(onChange).toHaveBeenLastCalledWith('planning')

    await user.keyboard('{End}')
    expect(onChange).toHaveBeenLastCalledWith('artifacts')
  })

  /**
   * The active state is a violet underline and violet text. A violet focus ring
   * would say the same thing twice, leaving a keyboard user unable to tell
   * where they are from what is selected — so this is the one control in the
   * app whose ring is not the brand colour.
   */
  it('separates the focus ring from the active colour', () => {
    renderTabs()
    const tab = screen.getByRole('tab', { selected: true })
    expect(tab.className).toContain('focus-visible:ring-slate-800')
    expect(tab.className).not.toMatch(/focus-visible:ring-violet/)
  })

  /** An overflowing row says there is more, rather than simply ending. */
  it('fades its edges rather than wrapping to a second line', () => {
    const { container } = renderTabs()
    expect(strip).not.toContain('flex-wrap')
    expect(container.querySelectorAll('.bg-gradient-to-r, .bg-gradient-to-l')).toHaveLength(2)
  })

  /** Out, then in — and never both panels at once, since one of these tabs
   *  fetches a chat list on mount. */
  it('fades the panel across a switch instead of cutting', () => {
    expect(css).toMatch(/\.mila-tabpanel\s*\{[^}]*transition:\s*opacity/)
    expect(css).toMatch(/\.mila-tabpanel\[data-leaving='true'\]\s*\{[^}]*opacity:\s*0/)
    // Faster out than in: the outgoing panel is already spent.
    const out = /\.mila-tabpanel\[data-leaving='true'\]\s*\{[^}]*transition-duration:\s*(\d+)ms/.exec(css)
    const inMs = /\.mila-tabpanel\s*\{[^}]*transition:\s*opacity (\d+)ms/.exec(css)
    expect(Number(out?.[1])).toBeLessThan(Number(inMs?.[1]))
  })
})
