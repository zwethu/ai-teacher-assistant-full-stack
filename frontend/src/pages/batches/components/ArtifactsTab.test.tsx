// @vitest-environment jsdom

import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ArtifactsTab } from './ArtifactsTab'
import type { Artifact } from '../../../services/artifactService'
import type { GameSession } from '../../../services/gameService'

afterEach(cleanup)

const artifact = (over: Partial<Artifact> = {}): Artifact =>
  ({
    id: 'a1',
    type: 'lesson_plan',
    title: 'Week 3 — Test Doubles',
    week: 3,
    version: 2,
    is_current: true,
    status: 'confirmed',
    created_at: '2026-08-01T09:00:00Z',
    doc_url: 'https://docs.example/a1',
    ...over,
  }) as Artifact

const game = (over: Partial<GameSession> = {}): GameSession =>
  ({
    gameId: 'g1',
    batchId: 'b1',
    lecturerId: 'u1',
    chatId: 'c1',
    runId: 'r1',
    title: 'Testing Terms Match-Up',
    items: [{ id: 'i1', term: 'mock', definition: 'a stand-in for a real collaborator' }],
    itemCount: 30,
    modes: [],
    gameModeStats: {},
    status: 'ready',
    contentHash: 'h',
    createdAt: '2026-08-02T09:00:00Z',
    ...over,
  }) as unknown as GameSession

function renderTab(over: Partial<Parameters<typeof ArtifactsTab>[0]> = {}) {
  const props = {
    artifacts: [artifact()],
    games: [game()],
    summary: null,
    loading: false,
    onRefresh: vi.fn(),
    onDelete: vi.fn(),
    onDeleteGame: vi.fn(),
    batchId: 'b1',
    onGameUpdated: vi.fn(),
    onError: vi.fn(),
    ...over,
  }
  return { ...render(<ArtifactsTab {...props} />), props }
}

const rowFor = (title: string) => screen.getByTitle(title).closest('.grid') as HTMLElement

/* A game is no longer a flattened artifact row: it renders the same `GameRow`
   the standalone Games page does, so it is found by its heading rather than by
   the `title` attribute the generic row carries. */
const gameRow = (title: string) =>
  screen.getByRole('heading', { name: title }).closest('div.divide-y > div') as HTMLElement
const queryGame = (title: string) => screen.queryByRole('heading', { name: title })

describe('generated content', () => {
  /**
   * Games live in their own collection, so they arrive from a second call and
   * never appeared here. To a lecturer "generated content" plainly includes the
   * game the agent just made.
   */
  it('lists games alongside artifacts', () => {
    renderTab()
    expect(screen.getByTitle('Week 3 — Test Doubles')).toBeTruthy()
    expect(queryGame('Testing Terms Match-Up')).toBeTruthy()
  })

  it('orders everything by when it was made, newest first', () => {
    renderTab()
    const titles = [
      ...document.querySelectorAll('.truncate.text-sm.font-semibold, h3.truncate'),
    ].map((node) => node.textContent)
    // The game is a day newer than the lesson plan.
    expect(titles).toEqual(['Testing Terms Match-Up', 'Week 3 — Test Doubles'])
  })

  /**
   * The tab used to flatten a game into the generic artifact row — a title, a
   * type chip and the string "30 pairs" — which dropped the results download,
   * the pair list and the entire deadline band. The same object was two
   * different objects depending on which page you found it from.
   */
  it('gives a game the same row the Games page does', () => {
    renderTab()
    const row = gameRow('Testing Terms Match-Up')
    expect(within(row).getByRole('button', { name: /30 pairs/ })).toBeTruthy()
    expect(within(row).getByRole('button', { name: 'Results' })).toBeTruthy()
    expect(within(row).getByRole('button', { name: /Copy link/ })).toBeTruthy()
    expect(within(row).getByRole('link', { name: /Open game/ }).getAttribute('href')).toContain(
      '/play/g1',
    )
    // The deadline band, which the flattened row had no room for at all.
    expect(within(row).getByRole('button', { name: /Close now/ })).toBeTruthy()
  })

  it('shows a deadline when the game has one', () => {
    renderTab({ games: [game({ deadlineAt: '2026-08-12T17:00:00Z' })] })
    expect(screen.getByText(/^Due /)).toBeTruthy()
  })

  it('lets a game be expanded to its pairs in place', async () => {
    const user = userEvent.setup()
    renderTab()
    const row = gameRow('Testing Terms Match-Up')
    await user.click(within(row).getByRole('button', { name: /30 pairs/ }))
    expect(within(gameRow('Testing Terms Match-Up')).getByText('mock')).toBeTruthy()
  })

  /** A game has no version chain, so a "Versions" button would open nothing. */
  it('offers versions for an artifact but not for a game', () => {
    renderTab()
    expect(within(rowFor('Week 3 — Test Doubles')).getByText('Versions')).toBeTruthy()
    expect(within(gameRow('Testing Terms Match-Up')).queryByText('Versions')).toBeNull()
  })

  it('routes a game deletion to the games API, not the artifact one', async () => {
    const user = userEvent.setup()
    const { props } = renderTab()
    await user.click(
      within(gameRow('Testing Terms Match-Up')).getByRole('button', {
        name: 'Delete Testing Terms Match-Up',
      }),
    )

    expect(props.onDeleteGame).toHaveBeenCalledWith(expect.objectContaining({ gameId: 'g1' }))
    expect(props.onDelete).not.toHaveBeenCalled()
  })

  it('filters to games alone', async () => {
    const user = userEvent.setup()
    renderTab()
    await user.click(screen.getByLabelText('Filter by type'))
    await user.click(screen.getByRole('option', { name: 'Games' }))

    expect(queryGame('Testing Terms Match-Up')).toBeTruthy()
    expect(screen.queryByTitle('Week 3 — Test Doubles')).toBeNull()
  })

  /**
   * A game has no week. Asking for one week's material and being handed a game
   * that belongs to no week would be wrong — but so would hiding every game
   * behind "Current only", which is about superseded versions a game cannot
   * have.
   */
  it('drops games from a week filter but keeps them under "Current only"', async () => {
    const user = userEvent.setup()
    renderTab()

    await user.click(screen.getByLabelText('Filter by week'))
    await user.click(screen.getByRole('option', { name: 'Week 3' }))
    expect(queryGame('Testing Terms Match-Up')).toBeNull()

    await user.click(screen.getByLabelText('Filter by week'))
    await user.click(screen.getByRole('option', { name: 'All weeks' }))
    await user.click(screen.getByLabelText('Current only'))
    expect(queryGame('Testing Terms Match-Up')).toBeTruthy()
  })

  /** The server-side summary counts artifacts, which games are not. */
  it('counts games itself rather than reading a total that excludes them', () => {
    renderTab({ games: [game(), game({ gameId: 'g2', title: 'Second' })] })
    // Anchored on the tile's own subtitle: "Games" also labels the type chip
    // on every game row, so the bare text matches several elements.
    const tile = screen.getByText('no versions kept').parentElement as HTMLElement
    expect(within(tile).getByText('Games')).toBeTruthy()
    expect(within(tile).getByText('2')).toBeTruthy()
  })

  it('says so when a batch has produced nothing at all', () => {
    renderTab({ artifacts: [], games: [] })
    expect(screen.getByText('Nothing generated for this batch yet.')).toBeTruthy()
  })
})
