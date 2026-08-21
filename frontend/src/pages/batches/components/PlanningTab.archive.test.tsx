// @vitest-environment jsdom

/**
 * Archiving a Course Plan used to be a one-way door in practice: the plan vanished
 * from the current card and the empty state told the lecturer to generate a new one
 * or save from Chat — neither of which can bring the archived plan back. These pin
 * the way out to the surface the lecturer is actually looking at.
 */

import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const getCurrent = vi.fn()
const listHistory = vi.fn()
const archiveCall = vi.fn()
const restoreCall = vi.fn()
const revertCall = vi.fn()

vi.mock('../../../services/courseBlueprintService', () => ({
  getCurrentCourseBlueprint: (...args: unknown[]) => getCurrent(...args),
  listCourseBlueprintHistory: (...args: unknown[]) => listHistory(...args),
  archiveCurrentCourseBlueprint: (...args: unknown[]) => archiveCall(...args),
  restoreCourseBlueprintVersion: (...args: unknown[]) => restoreCall(...args),
  revertToCourseBlueprintVersion: (...args: unknown[]) => revertCall(...args),
  deleteCourseBlueprintVersion: vi.fn(),
  updateCurrentCourseBlueprint: vi.fn(),
}))
vi.mock('../../../services/batchService', () => ({
  getBatchById: async () => ({ id: 'b1', batch_name: 'ged math', course_name: 'math' }),
}))
vi.mock('../../../hooks/useGenerationRun', () => ({
  useGenerationRun: () => ({ messages: [], currentRunId: '', sending: false, generate: vi.fn(), reset: vi.fn() }),
}))
vi.mock('../../../components/generation/GenerationRunView', () => ({ GenerationRunView: () => null }))
vi.mock('../../../components/generation/GenerationAttachments', () => ({ GenerationAttachments: () => null }))

import { PlanningTab } from './PlanningTab'
import { UndoHost } from '../../../components/ui/UndoToast'
import { resetUndoStore } from '../../../components/ui/undoStore'
import type { CourseBlueprint } from '../../../services/courseBlueprintService'

const plan = (over: Partial<CourseBlueprint> = {}): CourseBlueprint =>
  ({
    blueprint_id: 'bp1', batch_id: 'b1', lecturer_id: 'u1', course_name: 'math',
    status: 'active', version: 1, is_current: true, content_hash: 'h',
    title: 'GED Math: Fractions', summary: 'S', weekly_plan: [], assessment_strategy: '',
    lab_strategy: '', teaching_preferences: {}, open_questions: [],
    created_at: '2026-08-14T09:30:29Z', updated_at: '2026-08-14T09:30:29Z',
    ...over,
  }) as CourseBlueprint

const archived = plan({ status: 'archived', is_current: false })

beforeEach(() => {
  vi.clearAllMocks()
  resetUndoStore()
})
afterEach(cleanup)

describe('a Course Plan that has been archived', () => {
  it('is offered back by name from the empty state, not just buried in history', async () => {
    getCurrent.mockResolvedValue(null)
    listHistory.mockResolvedValue([archived])
    restoreCall.mockResolvedValue(plan())

    render(<PlanningTab batchId="b1" />)
    await screen.findByText('No active Course Plan')

    // The plan is named on the surface the lecturer is already looking at...
    expect(screen.getByText('GED Math: Fractions')).toBeTruthy()
    expect(screen.getByText(/Nothing was deleted/)).toBeTruthy()

    // ...and one click puts it back.
    await userEvent.click(screen.getByRole('button', { name: /Restore v1/ }))
    expect(restoreCall).toHaveBeenCalledWith('b1', 'bp1')
  })

  it('offers Restore in version history rather than a cloning "Make current"', async () => {
    getCurrent.mockResolvedValue(null)
    listHistory.mockResolvedValue([archived])
    restoreCall.mockResolvedValue(plan())

    render(<PlanningTab batchId="b1" />)
    const row = (await screen.findByText(/v1 · GED Math/)).closest('details') as HTMLElement

    expect(within(row).queryByRole('button', { name: /Make current/ })).toBeNull()
    await userEvent.click(within(row).getByRole('button', { name: /Restore/ }))
    expect(restoreCall).toHaveBeenCalledWith('b1', 'bp1')
    expect(revertCall).not.toHaveBeenCalled()
  })

  it('still offers the plain empty state when nothing was ever archived', async () => {
    getCurrent.mockResolvedValue(null)
    listHistory.mockResolvedValue([])

    render(<PlanningTab batchId="b1" />)
    await screen.findByText('No active Course Plan')
    expect(screen.getByRole('button', { name: /Generate with AI/ })).toBeTruthy()
    expect(screen.queryByText(/Nothing was deleted/)).toBeNull()
  })
})

describe('archiving', () => {
  it('says where the plan went and holds the call open for an undo', async () => {
    getCurrent.mockResolvedValue(plan())
    listHistory.mockResolvedValue([plan()])

    render(<><PlanningTab batchId="b1" /><UndoHost /></>)
    await screen.findByText(/Current · Version 1/)

    await userEvent.click(screen.getByRole('button', { name: /Archive/ }))

    // The card is gone immediately, the toast explains where it went, and the
    // request has not been sent yet — undo means it never happened at all.
    await waitFor(() => expect(screen.getByText('No active Course Plan')).toBeTruthy())
    expect(screen.getByText(/stays in Version history/)).toBeTruthy()
    expect(archiveCall).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: /Undo/ }))
    await waitFor(() => expect(screen.getByText(/Current · Version 1/)).toBeTruthy())
    expect(archiveCall).not.toHaveBeenCalled()
  })
})
