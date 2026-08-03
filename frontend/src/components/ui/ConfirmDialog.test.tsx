// @vitest-environment jsdom

import { readFileSync } from 'node:fs'

import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'

import { ConfirmHost } from './ConfirmDialog'
import { confirm, resetConfirmStore } from './confirmStore'

const css = readFileSync('src/index.css', 'utf8')

afterEach(() => {
  cleanup()
  resetConfirmStore()
})

const dialog = () => screen.queryByRole('alertdialog')

describe('confirm()', () => {
  /**
   * The whole reason it is a promise. Five of the app's confirmations live
   * inside `useBatchesPage.ts`, which renders nothing and cannot hold a
   * dialog — a component-shaped API could not serve them at all.
   */
  it('resolves to the button that was pressed, from outside React', async () => {
    const user = userEvent.setup()
    render(<ConfirmHost />)

    const asked = confirm({ title: 'Delete this?', confirmLabel: 'Delete' })
    const box = await screen.findByRole('alertdialog')
    await user.click(within(box).getByRole('button', { name: 'Delete' }))

    expect(await asked).toBe(true)
    await waitFor(() => expect(dialog()).toBeNull())

    const again = confirm({ title: 'Delete this?' })
    await screen.findByRole('alertdialog')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(await again).toBe(false)
  })

  /**
   * The question and the consequence are two things. Every message this
   * replaced was already written that way — `Delete "x"?`, blank line, what it
   * costs — and `window.confirm` rendered both as one run of grey text.
   */
  it('names the dialog by the question and describes it by the consequence', async () => {
    render(<ConfirmHost />)
    void confirm({ title: 'Delete "Week 03"?', body: 'This cannot be undone.' })

    const box = await screen.findByRole('alertdialog')
    const title = document.getElementById(box.getAttribute('aria-labelledby') ?? '')
    const body = document.getElementById(box.getAttribute('aria-describedby') ?? '')
    expect(title?.textContent).toBe('Delete "Week 03"?')
    expect(body?.textContent).toBe('This cannot be undone.')
  })

  /**
   * Escape has to work, and it has to work as a cancel — the safe direction.
   * The vendored `Modal` this replaced declared `aria-modal` and implemented
   * none of the behaviour that claim implies.
   */
  it('cancels on Escape', async () => {
    const user = userEvent.setup()
    render(<ConfirmHost />)

    const asked = confirm({ title: 'Sign out?' })
    await screen.findByRole('alertdialog')
    await user.keyboard('{Escape}')

    expect(await asked).toBe(false)
  })

  /**
   * A dialog that interrupts must not let a keystroke already in flight
   * complete the dangerous half of it, so focus starts on Cancel whenever the
   * confirm button is destructive.
   */
  it('opens with focus on Cancel when the action is destructive', async () => {
    render(<ConfirmHost />)
    void confirm({ title: 'Delete this?', tone: 'danger', confirmLabel: 'Delete' })

    await screen.findByRole('alertdialog')
    await waitFor(() =>
      expect(document.activeElement?.textContent).toBe('Cancel'),
    )
  })

  /**
   * Focus goes back where it came from. Without it the dialog closes and focus
   * falls to `<body>`, so the next Tab restarts at the top of the page and a
   * keyboard user loses their place every time they cancel something.
   */
  it('returns focus to whatever opened it', async () => {
    const user = userEvent.setup()
    render(
      <>
        <button type="button">Delete file</button>
        <ConfirmHost />
      </>,
    )
    const opener = screen.getByRole('button', { name: 'Delete file' })
    opener.focus()

    const asked = confirm({ title: 'Delete this?' })
    await screen.findByRole('alertdialog')
    await user.keyboard('{Escape}')
    await asked

    await waitFor(() => expect(document.activeElement).toBe(opener))
  })

  /**
   * The GitHub gate, and only for the two actions with no way back — deleting
   * a batch with every student in it, and deleting an artifact along with its
   * Google Drive file.
   */
  it('holds the confirm button shut until the phrase is typed', async () => {
    const user = userEvent.setup()
    render(<ConfirmHost />)
    void confirm({
      title: 'Delete "ST 26"?',
      confirmPhrase: 'ST 26',
      confirmLabel: 'Delete batch',
      tone: 'danger',
    })

    const box = await screen.findByRole('alertdialog')
    const accept = within(box).getByRole('button', { name: 'Delete batch' }) as HTMLButtonElement
    expect(accept.disabled).toBe(true)

    await user.type(within(box).getByRole('textbox'), 'ST 2')
    expect(accept.disabled).toBe(true)

    await user.type(within(box).getByRole('textbox'), '6')
    expect(accept.disabled).toBe(false)

    /* And it has to *look* shut. The design system fades a disabled button to
       `opacity: .55`, which on a red fill is just a paler red — measured in a
       browser as `rgb(220,38,38)` either way. The override needs `!` on every
       declaration, because the design system injects its CSS unlayered and an
       unlayered rule beats anything in Tailwind v4's `@layer utilities`
       regardless of specificity: the unprefixed classes were emitted and
       silently lost the cascade. */
    for (const cls of [
      'disabled:!bg-slate-200',
      'disabled:!text-slate-500',
      'disabled:!opacity-100',
    ]) {
      expect(accept.className).toContain(cls)
    }
  })

  /**
   * One column, not an icon rail beside a text column.
   *
   * Side-by-side left the gutter under the icon empty, so the title and body
   * started well inside the panel while the buttons ran out to its full width
   * — three different left edges on a box with four things in it. Every
   * element being a direct child of the panel is what makes them share its
   * padding; nest the text back into a column and the insets diverge again.
   */
  it('lays every element out on the panel’s own edges', async () => {
    render(<ConfirmHost />)
    void confirm({
      title: 'Delete this?',
      body: 'It cannot be undone.',
      confirmPhrase: 'delete',
      tone: 'danger',
    })

    const box = await screen.findByRole('alertdialog')
    const children = [...box.children]
    const titleId = box.getAttribute('aria-labelledby')
    const bodyId = box.getAttribute('aria-describedby')

    expect(children.some((el) => el.id === titleId)).toBe(true)
    expect(children.some((el) => el.id === bodyId)).toBe(true)
    expect(children.some((el) => el.querySelector('[data-confirm-phrase]'))).toBe(true)
    expect(children.some((el) => el.querySelector('[data-confirm-accept]'))).toBe(true)

    /* And the two buttons split the row evenly rather than being sized by
       their labels, which would make "Delete permanently" tower over
       "Cancel". Asserted as the grid that does it — jsdom lays nothing out. */
    const actions = children.find((el) => el.querySelector('[data-confirm-accept]'))
    expect(actions?.className).toContain('grid-cols-2')
  })

  /* jsdom has no layout and no `inert` semantics, so the trap's *effect*
     cannot be observed here — only that the handler exists to enforce it. The
     entrance is CSS, which jsdom does not apply either. */
  it('animates in rather than appearing between frames', () => {
    expect(css).toMatch(/@starting-style\s*\{[^@]*\.mila-dialog\s*\{[^}]*opacity:\s*0/)
    expect(css).toMatch(/\.mila-dialog\[data-leaving='true'\]/)
    expect(css).toMatch(/\.mila-dialog-backdrop\s*\{[^}]*backdrop-filter/)
  })
})
