// @vitest-environment jsdom

import { createRef, type ComponentProps } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Batch } from '../../../entity/Batch'
import { BatchSelectorBar } from './BatchSelectorBar'
import { ChatPageHeader } from './ChatPageHeader'

afterEach(() => cleanup())

function batch(id: string, name: string): Batch {
  return { id, batch_name: name, course_name: `${name} course` } as Batch
}

const BATCHES = [batch('b1', 'Software Testing 26'), batch('b2', 'Data Mining 26')]

function headerProps(
  overrides: Partial<ComponentProps<typeof ChatPageHeader>> = {},
): ComponentProps<typeof ChatPageHeader> {
  return {
    selectedBatch: BATCHES[0],
    batches: BATCHES,
    onSelectBatch: vi.fn(),
    activeChat: null,
    renamingId: null,
    renameValue: '',
    renameInputRef: createRef<HTMLInputElement>(),
    onRenameValueChange: vi.fn(),
    onStartRename: vi.fn(),
    onCommitRename: vi.fn(),
    onCancelRename: vi.fn(),
    onDeleteChat: vi.fn(),
    onOpenPanel: vi.fn(),
    panelOpen: false,
    ...overrides,
  }
}

describe('space switching after the composer chip was removed', () => {
  it('lets the header title switch spaces when there is more than one', () => {
    const onSelectBatch = vi.fn()
    render(<ChatPageHeader {...headerProps({ onSelectBatch })} />)

    fireEvent.click(screen.getByRole('button', { name: 'Switch space' }))
    fireEvent.click(screen.getByText('Data Mining 26'))

    expect(onSelectBatch).toHaveBeenCalledWith(BATCHES[1])
  })

  it('leaves the title as plain text when there is nowhere to switch to', () => {
    render(<ChatPageHeader {...headerProps({ batches: [BATCHES[0]] })} />)

    expect(screen.queryByRole('button', { name: 'Switch space' })).toBeNull()
    expect(screen.getByText('Software Testing 26')).toBeTruthy()
  })

  it('still selects a space from the composer chip when none is chosen', () => {
    const onSelectBatch = vi.fn()
    render(
      <MemoryRouter>
        <BatchSelectorBar batches={BATCHES} batchesLoading={false} onSelectBatch={onSelectBatch} />
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByText('Select a batch'))
    fireEvent.click(screen.getByText('Software Testing 26'))

    expect(onSelectBatch).toHaveBeenCalledWith(BATCHES[0])
  })
})
