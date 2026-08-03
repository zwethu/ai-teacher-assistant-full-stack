// @vitest-environment jsdom

import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Menu, MenuItem, MenuSeparator } from './Menu'

afterEach(cleanup)

function Harness({ onRename = () => {} }: { onRename?: () => void }) {
  return (
    /* The card the chat rows live in. `overflow-hidden` is the whole reason the
       panel is portalled — it used to slice the last row's menu in half. */
    <div className="overflow-hidden" data-testid="card">
      <Menu label="Chat actions" width="w-44">
        <MenuItem onSelect={onRename}>Rename</MenuItem>
        <MenuSeparator />
        <MenuItem danger onSelect={() => {}}>
          Delete
        </MenuItem>
      </Menu>
    </div>
  )
}

const open = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole('button', { name: 'Chat actions' }))
  return screen.findByRole('menu')
}

describe('Menu', () => {
  /**
   * The defect this component exists for. The chat card clips its overflow, and
   * an absolutely-positioned panel cannot escape a clipping ancestor — the last
   * row's menu showed one item and lost the rest. A portal is the only fix that
   * does not involve un-clipping the card.
   */
  it('renders outside the clipping ancestor it was opened from', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const panel = await open(user)

    expect(screen.getByTestId('card').contains(panel)).toBe(false)
    expect(panel.parentElement).toBe(document.body)
  })

  /**
   * Focus has to land on an item, and it could not while the panel was still
   * `visibility: hidden` awaiting measurement — a hidden element takes no
   * focus, so the arrow keys and Escape were both dead on arrival. This is the
   * observable half of that fix: jsdom has no layout, so what it proves is that
   * focus lands at all, not the frame it lands on.
   */
  it('puts focus on the first item so the keyboard has somewhere to land', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const panel = await open(user)

    await waitFor(() =>
      expect(document.activeElement).toBe(within(panel).getByRole('menuitem', { name: 'Rename' })),
    )
  })

  it('walks the items with the arrow keys and wraps', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const panel = await open(user)
    const item = (name: string) => within(panel).getByRole('menuitem', { name })

    await waitFor(() => expect(document.activeElement).toBe(item('Rename')))
    await user.keyboard('{ArrowDown}')
    expect(document.activeElement).toBe(item('Delete'))
    // Wraps rather than stopping dead at the end.
    await user.keyboard('{ArrowDown}')
    expect(document.activeElement).toBe(item('Rename'))
    await user.keyboard('{ArrowUp}')
    expect(document.activeElement).toBe(item('Delete'))
  })

  /**
   * Escape is bound to the document, not to the panel. A pointer user's focus
   * never enters the menu, so a panel-scoped handler left them with no key that
   * dismissed it.
   */
  it('closes on Escape and hands focus back to the trigger', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await open(user)

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Chat actions' }))
  })

  it('runs the item and closes on select', async () => {
    const user = userEvent.setup()
    const onRename = vi.fn()
    render(<Harness onRename={onRename} />)
    const panel = await open(user)

    await user.click(within(panel).getByRole('menuitem', { name: 'Rename' }))
    expect(onRename).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
  })

  /**
   * An item that keeps the menu open — the exports, whose spinner is the only
   * sign anything is happening — gets a `close` of its own to call when its
   * work finishes.
   */
  it('lets an async item close itself when it is done', async () => {
    const user = userEvent.setup()
    const held: { close?: () => void } = {}
    render(
      <Menu label="Chat actions">
        <MenuItem keepOpen onSelect={(close) => { held.close = close }}>
          Export as PDF
        </MenuItem>
      </Menu>,
    )
    const panel = await open(user)

    await user.click(within(panel).getByRole('menuitem', { name: 'Export as PDF' }))
    expect(screen.queryByRole('menu')).not.toBeNull()

    held.close?.()
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
  })

  /** The trigger and the labels, both of which were about half this size. */
  it('is big enough to aim at', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const trigger = screen.getByRole('button', { name: 'Chat actions' })
    // 36px, from `h-9 w-9` — jsdom lays nothing out, so the classes stand in.
    expect(trigger.className).toContain('h-9')
    expect(trigger.className).toContain('w-9')

    const panel = await open(user)
    const item = within(panel).getByRole('menuitem', { name: 'Rename' })
    expect(item.className).toContain('text-sm')
    expect(item.className).toContain('py-2.5')
  })

  it('is opaque, so nothing behind it reads through', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const panel = await open(user)
    expect(panel.className).toContain('bg-white')
    expect(panel.className).not.toMatch(/bg-white\/\d/)
  })
})
