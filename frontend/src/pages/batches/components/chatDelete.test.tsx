// @vitest-environment jsdom

import { createRef } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { MaterialsTab } from './MaterialsTab'
import { ConfirmHost } from '../../../components/ui/ConfirmDialog'
import { UndoHost } from '../../../components/ui/UndoToast'
import { commitNow, resetUndoStore } from '../../../components/ui/undoStore'
import { resetConfirmStore } from '../../../components/ui/confirmStore'

const listChats = vi.fn()
const deleteChat = vi.fn()

vi.mock('../../../services/chatService', () => ({
  CHAT_PAGE_SIZE: 30,
  listChats: (...args: unknown[]) => listChats(...args),
  listMessages: vi.fn(),
  createChat: vi.fn(),
  deleteChat: (...args: unknown[]) => deleteChat(...args),
  updateChatTitle: vi.fn(),
  uploadChatAttachment: vi.fn(),
}))

vi.mock('../../../services/courseBlueprintService', () => ({
  getCurrentCourseBlueprint: vi.fn(() => Promise.resolve(null)),
}))

afterEach(() => {
  cleanup()
  resetConfirmStore()
  resetUndoStore()
  listChats.mockReset()
  deleteChat.mockReset()
})

const chat = (id: string, title: string) => ({
  chat_id: id,
  batch_id: 'batch-1',
  lecturer_id: 'l1',
  title,
  preview: '',
  created_at: null,
  updated_at: null,
})

async function renderTab() {
  listChats.mockResolvedValue([chat('c1', 'Week 3 lab'), chat('c2', 'Quiz ideas')])
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
      />
      <ConfirmHost />
      <UndoHost />
    </MemoryRouter>,
  )
  await screen.findByText('Week 3 lab')
}

/** Open the row's ⋯ menu and choose Delete. */
async function chooseDelete(user: ReturnType<typeof userEvent.setup>, title: string) {
  const row = screen.getByText(title).closest('li') as HTMLElement
  await user.click(within(row).getByRole('button', { name: 'Chat actions' }))
  const menu = await screen.findByRole('menu')
  await user.click(within(menu).getByRole('menuitem', { name: 'Delete' }))
}

describe('deleting a chat', () => {
  /**
   * The row used to swap its menu button for a tick and a cross — two 14px
   * targets side by side, the left of which deleted the conversation outright
   * with nothing on screen naming what was about to go.
   */
  it('asks in a dialog rather than with a tick and a cross', async () => {
    const user = userEvent.setup()
    await renderTab()
    await chooseDelete(user, 'Week 3 lab')

    expect(await screen.findByRole('alertdialog')).toBeTruthy()
    expect(screen.getByText('Delete "Week 3 lab"?')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Confirm delete/ })).toBeNull()

    // The menu hands focus back to its trigger as it closes, and the dialog
    // takes it in the same beat. Whichever wins, the keyboard has to end up in
    // the dialog — otherwise Escape and Tab are talking to the page behind it.
    await waitFor(() =>
      expect(screen.getByRole('alertdialog').contains(document.activeElement)).toBe(true),
    )
    // On a destructive ask, the safe button is the one under the cursor.
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }))
  })

  it('leaves the chat alone when the dialog is cancelled', async () => {
    const user = userEvent.setup()
    await renderTab()
    await chooseDelete(user, 'Week 3 lab')

    await user.click(await screen.findByRole('button', { name: 'Cancel' }))

    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(screen.getByText('Week 3 lab')).toBeTruthy()
    expect(deleteChat).not.toHaveBeenCalled()
  })

  /**
   * Deferred commit: confirming takes the row off screen but nothing has been
   * sent yet. That is what makes the ten seconds a real second chance rather
   * than an apology for something already gone.
   */
  it('hides the row but holds the delete for the undo window', async () => {
    const user = userEvent.setup()
    await renderTab()
    await chooseDelete(user, 'Week 3 lab')
    await user.click(await screen.findByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(screen.queryByText('Week 3 lab')).toBeNull())
    expect(screen.getByText('Quiz ideas'), 'took the wrong row with it').toBeTruthy()
    expect(deleteChat, 'deleted before the window was up').not.toHaveBeenCalled()

    // The window closing is what sends it. (The clock itself is undoStore's.)
    commitNow('c1')
    await waitFor(() => expect(deleteChat).toHaveBeenCalledWith('batch-1', 'c1'))
  })

  it('puts the chat back on undo, and never deletes it', async () => {
    const user = userEvent.setup()
    await renderTab()
    await chooseDelete(user, 'Week 3 lab')
    await user.click(await screen.findByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(screen.queryByText('Week 3 lab')).toBeNull())

    await user.click(await screen.findByRole('button', { name: 'Undo' }))

    expect(await screen.findByText('Week 3 lab')).toBeTruthy()
    expect(deleteChat).not.toHaveBeenCalled()
  })
})
