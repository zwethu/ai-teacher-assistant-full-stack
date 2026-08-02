import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const shell = readFileSync('src/components/layout/AppLayout.tsx', 'utf8')
const sidebar = readFileSync('src/components/layout/Sidebar.tsx', 'utf8')

describe('the app shell', () => {
  /**
   * The page scroller reserves its gutter.
   *
   * Routes and tabs differ in height — the Chats tab locks itself to the
   * viewport and never scrolls, Generated content with a dozen rows does — so
   * without a stable gutter the scrollbar appears and disappears between them
   * and every element steps sideways by its width on each switch. Measured
   * headless: a scroller without the property is 600px wide when its content
   * fits and 588px when it does not; with the property it is 588px either way.
   */
  it('reserves the scrollbar gutter so switching views cannot shift the page', () => {
    const scroller = /className="[^"]*flex-1 flex flex-col min-h-0 overflow-y-auto[^"]*"/.exec(shell)
    expect(scroller).toBeTruthy()
    expect(scroller![0]).toContain('scrollbar-gutter:stable')
  })
})

describe('the side navigation', () => {
  /**
   * It had no focus styling of any kind, so a keyboard user tabbing down the
   * main navigation saw nothing move.
   */
  it('shows where the keyboard is', () => {
    expect(sidebar).toMatch(/focus-visible:ring-2/)
  })

  /**
   * Slate, not violet, and for the same reason as the batch tabs: the active
   * item is a violet-tinted pill, so a violet ring would leave "where I am"
   * indistinguishable from "what I am on".
   */
  it('keeps the focus ring distinct from the active pill', () => {
    const focusLine = /const focus =\s*\n?\s*'([^']+)'/.exec(sidebar)
    expect(focusLine).toBeTruthy()
    expect(focusLine![1]).toContain('ring-slate-800')
    expect(focusLine![1]).not.toContain('ring-violet')
  })
})
