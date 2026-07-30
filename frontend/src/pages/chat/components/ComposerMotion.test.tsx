// @vitest-environment jsdom

import { createRef, type ComponentProps } from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ChatInput } from './ChatConversation'
import type { PendingChatAttachment } from '../hooks/useChatPage'

vi.mock('../../../services/chatService', () => ({
  listChatAttachments: vi.fn(() => Promise.resolve([])),
  getChatAttachmentContent: vi.fn(() => Promise.resolve(new Blob())),
}))

import {
  COMPOSER_EXIT_MS,
  ComposerCollapse,
  useComposerPresence,
  useExitDelay,
} from './ComposerSurface'

/**
 * React unmounts a removed list item on the same tick, so an attachment tile has
 * no way to animate out on its own. These two hooks hold a departed item for one
 * exit animation — the logic the composer's motion depends on.
 */

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

type Tile = { id: string; status: string }

function PresenceProbe({ tiles }: { tiles: Tile[] }) {
  const entries = useComposerPresence(tiles, (tile) => tile.id)
  return (
    <div data-testid="entries">
      {entries.map((entry) => `${entry.item.id}:${entry.item.status}${entry.leaving ? '*' : ''}`).join(',')}
    </div>
  )
}

const entries = () => screen.getByTestId('entries').textContent
const tick = (ms: number) => act(() => { vi.advanceTimersByTime(ms) })

function tiles(...ids: string[]): Tile[] {
  return ids.map((id) => ({ id, status: 'ready' }))
}

describe('useComposerPresence', () => {
  it('passes live items straight through', () => {
    render(<PresenceProbe tiles={tiles('a', 'b')} />)
    expect(entries()).toBe('a:ready,b:ready')
  })

  it('holds a removed tile in the position it occupied, then drops it', () => {
    const { rerender } = render(<PresenceProbe tiles={tiles('a', 'b', 'c')} />)

    rerender(<PresenceProbe tiles={tiles('a', 'c')} />)
    // Still in the middle — a ghost that jumps to the end would look like a bug.
    expect(entries()).toBe('a:ready,b:ready*,c:ready')

    tick(COMPOSER_EXIT_MS)
    expect(entries()).toBe('a:ready,c:ready')
  })

  it('holds every tile when a send clears the whole strip', () => {
    // The other route a tile leaves by. It is why this watches the list rather
    // than hooking the remove button.
    const { rerender } = render(<PresenceProbe tiles={tiles('a', 'b')} />)

    rerender(<PresenceProbe tiles={[]} />)
    expect(entries()).toBe('a:ready*,b:ready*')

    tick(COMPOSER_EXIT_MS)
    expect(entries()).toBe('')
  })

  it('does not treat a status change as a departure', () => {
    // An attachment finishing processing is the same tile, and restarting the
    // exit timer for it would cut short an unrelated ghost.
    const { rerender } = render(
      <PresenceProbe tiles={[{ id: 'a', status: 'processing' }, { id: 'b', status: 'ready' }]} />,
    )
    rerender(<PresenceProbe tiles={[{ id: 'a', status: 'ready' }, { id: 'b', status: 'ready' }]} />)

    expect(entries()).toBe('a:ready,b:ready')
  })

  it('lets a re-added tile win over its own expiring ghost', () => {
    const { rerender } = render(<PresenceProbe tiles={tiles('a')} />)
    rerender(<PresenceProbe tiles={[]} />)
    expect(entries()).toBe('a:ready*')

    rerender(<PresenceProbe tiles={tiles('a')} />)
    // One entry, not the live tile plus a duplicate ghost of itself.
    expect(entries()).toBe('a:ready')

    tick(COMPOSER_EXIT_MS)
    expect(entries()).toBe('a:ready')
  })
})

function CollapseProbe({ tiles }: { tiles: Tile[] }) {
  const entries = useComposerPresence(tiles, (tile) => tile.id)
  // The wiring under test: the box is driven by the entries, which include a
  // departing tile, not by the caller's list, which does not.
  return (
    <ComposerCollapse open={entries.length > 0}>
      <span>{entries.length}</span>
    </ComposerCollapse>
  )
}

describe('attachment strip open state', () => {
  it('opens on the first attachment and closes only after the last one has left', () => {
    const { container, rerender } = render(<CollapseProbe tiles={[]} />)
    const collapse = () => container.querySelector('.mila-composer-collapse')?.getAttribute('data-open')

    expect(collapse()).toBe('false')

    rerender(<CollapseProbe tiles={tiles('a')} />)
    expect(collapse()).toBe('true')

    rerender(<CollapseProbe tiles={[]} />)
    // Still open: closing here would collapse the box while the tile is mid-fade,
    // squashing it instead of letting it leave and then following.
    expect(collapse()).toBe('true')

    tick(COMPOSER_EXIT_MS)
    expect(collapse()).toBe('false')
  })

  it('stays open when one of several tiles is removed', () => {
    const { container, rerender } = render(<CollapseProbe tiles={tiles('a', 'b')} />)
    rerender(<CollapseProbe tiles={tiles('a')} />)
    tick(COMPOSER_EXIT_MS)

    expect(container.querySelector('.mila-composer-collapse')?.getAttribute('data-open')).toBe('true')
  })
})

// --- the real composer, not just the primitives ------------------------------

const attachment: PendingChatAttachment = {
  attachment_id: 'image-1', batch_id: 'batch-1', chat_id: 'chat-1', message_id: null,
  lecturer_id: 'lecturer-1', file_name: 'board.png', file_title: 'board.png',
  content_type: 'image/png', size_bytes: 1000,
  scope: 'chat', attachment_kind: 'image',
  status: 'ready', token_estimate: 1290,
  parse_status: 'skipped', vision_status: 'ready',
  extracted_text_preview: '', vision_summary: '', ocr_text: '',
  expires_at: null, promoted_file_id: null, promotion_allowed: false,
  thumbnail_available: true, created_at: null, updated_at: null,
  rag_status: 'ready', chunk_status: 'ready', embedding_status: 'skipped',
  semantic_search_ready: false, chunk_count: 1, indexed_chars: 20,
  ocr_status: 'not_needed', rag_updated_at: null,
}

function inputProps(
  overrides: Partial<ComponentProps<typeof ChatInput>> = {},
): ComponentProps<typeof ChatInput> {
  return {
    input: '', sending: false, textareaRef: createRef<HTMLTextAreaElement>(),
    onInputChange: vi.fn(), onInputKeyDown: vi.fn(), onTextareaInput: vi.fn(),
    onSend: vi.fn(), connectors: { web_search: false }, onConnectorsChange: vi.fn(),
    activeGenerateMode: null, onSelectGenerateMode: vi.fn(), onClearGenerateMode: vi.fn(),
    pendingAttachments: [], referencedAttachments: [], attachmentsUploading: false,
    attachmentErrors: [], onAttachmentFiles: vi.fn(), onRemoveAttachment: vi.fn(),
    onRemoveReferenced: vi.fn(), onPaste: vi.fn(),
    ...overrides,
  }
}

describe('ChatInput growth and return to rest', () => {
  it('grows on attach and returns to its resting size after the tile has left', () => {
    // Guards the wiring, not just the primitive: the strip has to be driven by
    // the presence entries. Driving it from the props collapses the box while
    // the tile is still fading.
    const { container, rerender } = render(<ChatInput {...inputProps()} />)
    const strip = () =>
      container.querySelector('[data-region="attachments"]')?.getAttribute('data-open')

    expect(strip()).toBe('false')

    rerender(<ChatInput {...inputProps({ pendingAttachments: [attachment] })} />)
    expect(strip()).toBe('true')
    expect(screen.getByRole('button', { name: 'Preview board.png' })).toBeTruthy()

    rerender(<ChatInput {...inputProps()} />)
    expect(strip()).toBe('true')

    tick(COMPOSER_EXIT_MS)
    expect(strip()).toBe('false')
  })

  it('eases the web-search shell open rather than snapping it', () => {
    const { container, rerender } = render(<ChatInput {...inputProps()} />)
    const tint = () => container.querySelector('.mila-composer-tint')?.getAttribute('data-active')

    expect(tint()).toBe('false')
    rerender(<ChatInput {...inputProps({ connectors: { web_search: true } })} />)
    expect(tint()).toBe('true')
    expect(screen.getByText(/Web search is on/)).toBeTruthy()
  })
})

function ExitDelayProbe({ active }: { active: boolean }) {
  return <div data-testid="mounted">{String(useExitDelay(active))}</div>
}

describe('useExitDelay', () => {
  it('keeps a deactivated element mounted for exactly one exit animation', () => {
    // The mode chip is rendered conditionally, and something unmounted cannot
    // animate its own exit.
    const { rerender } = render(<ExitDelayProbe active />)
    expect(screen.getByTestId('mounted').textContent).toBe('true')

    rerender(<ExitDelayProbe active={false} />)
    expect(screen.getByTestId('mounted').textContent).toBe('true')

    tick(COMPOSER_EXIT_MS)
    expect(screen.getByTestId('mounted').textContent).toBe('false')
  })

  it('cancels a pending unmount when it is reactivated', () => {
    const { rerender } = render(<ExitDelayProbe active />)
    rerender(<ExitDelayProbe active={false} />)
    rerender(<ExitDelayProbe active />)

    tick(COMPOSER_EXIT_MS * 2)
    expect(screen.getByTestId('mounted').textContent).toBe('true')
  })
})
