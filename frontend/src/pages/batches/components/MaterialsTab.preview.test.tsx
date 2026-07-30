// @vitest-environment jsdom

import { createRef } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { MaterialsTab } from './MaterialsTab'

const listChats = vi.fn()
const listMessages = vi.fn()

vi.mock('../../../services/chatService', () => ({
  listChats: (...args: unknown[]) => listChats(...args),
  listMessages: (...args: unknown[]) => listMessages(...args),
  createChat: vi.fn(),
  deleteChat: vi.fn(),
  updateChatTitle: vi.fn(),
  uploadChatAttachment: vi.fn(),
}))

vi.mock('../../../services/courseBlueprintService', () => ({
  getCurrentCourseBlueprint: vi.fn(() => Promise.resolve(null)),
}))

afterEach(() => {
  cleanup()
  listChats.mockReset()
  listMessages.mockReset()
})

function renderTab() {
  render(
    <MemoryRouter>
      <MaterialsTab
        batchId="batch-1"
        files={[]}
        filesLoading={false}
        fileUploading={false}
        fileInputRef={createRef<HTMLInputElement>()}
        onFileUpload={vi.fn()}
        onDeleteFile={vi.fn()}
        onRefreshFiles={vi.fn()}
        onOpenPlanning={vi.fn()}
      />
    </MemoryRouter>,
  )
}

describe('MaterialsTab chat list', () => {
  it('renders the denormalised preview without fetching any messages', async () => {
    // The list used to fan out into one listMessages call per chat on every visit,
    // reading whole message collections just to render these two subtitles.
    listChats.mockResolvedValue([
      { chat_id: 'c1', batch_id: 'batch-1', lecturer_id: 'l1', title: 'Week 3 lab',
        preview: 'help me plan a firebase lab', created_at: null, updated_at: null },
      { chat_id: 'c2', batch_id: 'batch-1', lecturer_id: 'l1', title: 'Quiz ideas',
        preview: 'ten questions on normalisation', created_at: null, updated_at: null },
    ])

    renderTab()

    expect(await screen.findByText('help me plan a firebase lab')).toBeTruthy()
    expect(screen.getByText('ten questions on normalisation')).toBeTruthy()
    expect(listChats).toHaveBeenCalledTimes(1)
    expect(listMessages).not.toHaveBeenCalled()
  })

  it('falls back to the title for chats that predate the preview field', async () => {
    listChats.mockResolvedValue([
      { chat_id: 'c1', batch_id: 'batch-1', lecturer_id: 'l1', title: 'An older chat',
        created_at: null, updated_at: null },
    ])

    renderTab()

    // Title still identifies it; no subtitle, and crucially no backfill fetch.
    expect(await screen.findByText('An older chat')).toBeTruthy()
    await waitFor(() => expect(listChats).toHaveBeenCalled())
    expect(listMessages).not.toHaveBeenCalled()
  })
})
