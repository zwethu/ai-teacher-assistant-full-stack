// @vitest-environment jsdom

import { cleanup, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { MaterialsTab } from './MaterialsTab'
import type { BatchFile } from '../../../entity/File'

const listChats = vi.fn()

vi.mock('../../../services/chatService', () => ({
  listChats: (...args: unknown[]) => listChats(...args),
  createChat: vi.fn(),
  deleteChat: vi.fn(),
  updateChatTitle: vi.fn(),
  uploadChatAttachment: vi.fn(),
  CHAT_PAGE_SIZE: 30,
}))

afterEach(cleanup)
beforeEach(() => {
  listChats.mockReset().mockResolvedValue([
    { chat_id: 'c1', title: 'Week 3 prep', preview: 'help me plan', updated_at: '2026-08-01T09:00:00Z' },
  ])
})

const file = (over: Partial<BatchFile> = {}): BatchFile =>
  ({
    file_id: 'f1',
    file_name: 'syllabus.pdf',
    file_title: 'syllabus.pdf',
    index_status: 'indexed',
    created_at: '2026-07-06T22:24:00Z',
    ...over,
  }) as BatchFile

function renderTab(over: Record<string, unknown> = {}) {
  const props = {
    batchId: 'b1',
    files: [file()],
    filesLoading: false,
    fileUploading: false,
    fileInputRef: { current: null },
    onFileUpload: vi.fn(),
    onDeleteFile: vi.fn(),
    onRefreshFiles: vi.fn(),
    ...over,
  }
  return render(
    <MemoryRouter>
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      <MaterialsTab {...(props as any)} />
    </MemoryRouter>,
  )
}

describe('Sessions tab structure', () => {
  /**
   * The row's click target used to be a `div` with an `onClick` — no tab stop,
   * no accessible name, no Enter handler. Opening a past chat is this tab's
   * first job and a keyboard or screen-reader user could not do it at all.
   */
  it('opens a past chat through a real link', async () => {
    renderTab()
    const link = await screen.findByRole('link', { name: 'Week 3 prep' })
    expect(link.getAttribute('href')).toBe('/batches/b1/chats/c1')
  })

  /** The title is on screen already; a hidden copy inside the link read twice. */
  it('names the link without duplicating the visible title', async () => {
    renderTab()
    await screen.findByRole('link', { name: 'Week 3 prep' })
    expect(screen.getAllByText('Week 3 prep')).toHaveLength(1)
  })

  /**
   * The action cluster is `opacity-0` until hover. Without a focus-within
   * counterpart, a keyboard user who tabbed to it was focused on something
   * rendered invisible.
   */
  it('reveals the row actions for the keyboard, not only the pointer', async () => {
    const { container } = renderTab()
    await screen.findByRole('link', { name: 'Week 3 prep' })
    const cluster = container.querySelector('[data-chat-menu]')
    expect(cluster?.className).toContain('group-hover:opacity-100')
    expect(cluster?.className).toContain('group-focus-within:opacity-100')
  })

  /**
   * A failed index used to render as a raw backend string in red, announced to
   * nobody, with no stated way out — and the only recovery is delete and
   * re-upload.
   */
  it('announces an indexing failure and names the recovery', async () => {
    renderTab({ files: [file({ index_status: 'failed', index_error: 'chunker timed out' })] })
    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText(/Could not index this file/)).toBeTruthy()
    expect(within(alert).getByText('chunker timed out')).toBeTruthy()
    expect(within(alert).getByText(/upload again to retry/)).toBeTruthy()
  })

  /**
   * `.pptx` is the format a lecturer is most likely to reach for, and the rail
   * silently greyed it out while the composer beside it accepted it.
   */
  it('accepts the format lecturers actually teach from', async () => {
    const { container } = renderTab()
    await screen.findByRole('link', { name: 'Week 3 prep' })
    const accepts = [...container.querySelectorAll('input[type="file"]')].map((node) =>
      node.getAttribute('accept'),
    )
    expect(accepts.every((value) => value?.includes('.pptx'))).toBe(true)
  })

  /** Named by consequence, so the two upload paths cannot be confused. */
  it('says what the space-level upload is for', async () => {
    renderTab()
    expect(
      await screen.findByText(/reads these in every chat about this space/i),
    ).toBeTruthy()
  })

  /**
   * The blueprint card was a navigation target in a rail whose job is files,
   * duplicating the Planning tab. Its facts moved to the batch header.
   */
  it('keeps the rail to course materials alone', async () => {
    renderTab()
    await screen.findByRole('link', { name: 'Week 3 prep' })
    expect(screen.queryByText(/Course Blueprint/i)).toBeNull()
    expect(screen.queryByRole('button', { name: /Open Blueprint/i })).toBeNull()
    expect(screen.getByText('Course materials')).toBeTruthy()
  })

  /**
   * Openings, so the lecturer is not met by an empty field — labelled short
   * enough to hold one row above a floating card, but inserting the whole
   * sentence they meant.
   */
  it('offers a way in rather than a blank composer', async () => {
    renderTab()
    const chip = await screen.findByRole('button', { name: 'Plan a lesson' })
    expect(chip.getAttribute('title')).toBe('Help me plan a lesson on this topic')
    expect(chip.className).toContain('whitespace-nowrap')
    // One row: the strip scrolls rather than wrapping under the composer.
    expect(chip.parentElement!.className).not.toContain('flex-wrap')
    expect(chip.parentElement!.className).toContain('overflow-x-auto')
  })

  /**
   * The composer belongs below the list, not above it. An earlier pass put it
   * at the top of the column; docked is where a lecturer looks for it, and it
   * is the position the list can scroll up through.
   */
  /**
   * The composer overlays the scroller rather than sitting in flow. `mt-auto`
   * and `sticky` both need every ancestor to resolve a definite height — three
   * attempts at those left it parked under the last row with a screen of dead
   * space beneath. An overlay needs only a positioned parent.
   */
  it('pins the composer to the foot of the column, over the scroller', async () => {
    const { container } = renderTab()
    await screen.findByRole('link', { name: 'Week 3 prep' })

    const band = container.querySelector('.absolute.bottom-0')
    expect(band).toBeTruthy()
    expect(band!.className).toContain('pointer-events-none')

    // Narrower than the list it floats over, and centred on it.
    const card = band!.querySelector('.pointer-events-auto')
    expect(card!.className).toContain('max-w-3xl')
    expect(card!.className).toContain('mx-auto')
  })

  /**
   * The bug that survived three attempts at this layout, and the reason the
   * composer kept landing mid-page.
   *
   * The band pins to `.relative.min-h-0.flex-1`, whose `flex-1` only resolves
   * if the root above it is a flex column with a definite height. An earlier
   * edit left that root as a bare `<div>`; every ancestor above it was fine,
   * so nothing failed — the chain simply stopped, the wrapper sized to its
   * content, and `bottom-0` came to rest 456px above the bottom of the screen.
   * Measured in a headless browser, not inferred.
   */
  it('keeps the height chain the composer pins to', async () => {
    const { container } = renderTab()
    await screen.findByRole('link', { name: 'Week 3 prep' })

    const root = container.firstElementChild as HTMLElement
    expect(root.className).toContain('h-full')
    expect(root.className).toContain('flex-col')

    const positioned = container.querySelector('.relative.flex-1') as HTMLElement
    expect(positioned).toBeTruthy()
    // The band's offset parent, so it must be the positioned one.
    expect(positioned.parentElement).toBe(root)
  })

  /**
   * The list has to be able to scroll clear of the composer covering it. The
   * reserve is the composer's measured height, not a guess — the suggestion
   * row comes and goes and a wrapped composer grows.
   */
  it('reserves room in the scroller so the last row clears the composer', async () => {
    const { container } = renderTab()
    await screen.findByRole('link', { name: 'Week 3 prep' })

    const scroller = container.querySelector('.overflow-y-auto') as HTMLElement
    expect(scroller).toBeTruthy()
    expect(Number.parseInt(scroller.style.paddingBottom, 10)).toBeGreaterThan(0)
  })

  /**
   * The list reads as an object, not as text lying on the page. The card was
   * never the problem — `lg:h-full` was, which stretched a panel holding two
   * rows to the full viewport.
   */
  it('gives the recent list a surface that sizes to its content', async () => {
    renderTab()
    await screen.findByRole('link', { name: 'Week 3 prep' })

    const heading = screen.getByRole('heading', { name: 'Recent' })
    const card = heading.parentElement!
    expect(card.className).toContain('bg-white')
    expect(card.className).toContain('border')
    // The column stretches, the card does not — `h-full` here is what stretched
    // a two-row panel to the whole viewport in the first place.
    expect(card.className).not.toContain('h-full')

    // And the column carries no width cap, which left a dead band between the
    // list and the materials rail.
    const column = card.parentElement!
    expect(column.className).not.toContain('max-w-2xl')
  })

  /** An opening, not permanent chrome under the lecturer's hands. */
  it('retires the openings once the composer has something in it', async () => {
    renderTab()
    const chip = await screen.findByRole('button', { name: 'Plan a lesson' })

    const user = (await import('@testing-library/user-event')).default.setup()
    await user.click(chip)

    expect(screen.queryByRole('button', { name: 'Plan a lesson' })).toBeNull()
  })

  /** Two lines, not a 192px well with an icon in the middle of it. */
  it('states an empty file list without reserving a panel for it', async () => {
    const { container } = renderTab({ files: [] })
    await screen.findByRole('link', { name: 'Week 3 prep' })
    expect(screen.getByText(/No materials yet/)).toBeTruthy()
    expect(container.querySelector('.min-h-\\[12rem\\]')).toBeNull()
  })
})
