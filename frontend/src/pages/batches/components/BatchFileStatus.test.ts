import { describe, expect, it } from 'vitest'
import type { BatchFile } from '../../../entity/File'
import { batchFileStatusLabel } from './MaterialsTab'

const file = (over: Partial<BatchFile>) => ({ ...over }) as BatchFile

/**
 * This line sits directly under `IndexStatusBadge`, which already carries
 * `index_status` in full — Uploading, Pending, Indexing, Indexed, Failed,
 * Deleting. Everything it says has to be something the badge cannot.
 */
describe('batch file composite status', () => {
  /** The duplicate: a finished file read "Indexed" twice, pill then text. */
  it('says nothing when the badge has already said it', () => {
    expect(batchFileStatusLabel(file({ index_status: 'indexed' }))).toBe('')
    expect(batchFileStatusLabel(file({ index_status: 'indexing' }))).toBe('')
    expect(batchFileStatusLabel(file({ index_status: 'failed' }))).toBe('')
  })

  /**
   * `retiring` is the backend retiring its own temporary copy. It used to
   * surface as "Indexed · Immediate overlay retained temporarily" — the word
   * "Indexed" again, plus a sentence about an implementation detail.
   */
  it('keeps the backend\'s own housekeeping off the screen', () => {
    expect(batchFileStatusLabel(file({ index_status: 'indexed', overlay_status: 'retiring' }))).toBe('')
  })

  /** The one fact the badge cannot carry: can MILA use this yet. */
  it('says whether the file is usable while indexing catches up', () => {
    expect(batchFileStatusLabel(file({ index_status: 'indexing', overlay_status: 'ready' })))
      .toBe('Usable now, while it finishes processing.')
    expect(batchFileStatusLabel(file({ index_status: 'failed', overlay_status: 'ready' })))
      .toBe('Usable in chats for now, but it will not be searchable.')
    expect(batchFileStatusLabel(file({ index_status: 'indexing', overlay_status: 'failed' })))
      .toBe('Not usable yet — still processing.')
  })

  /** Nothing here should read like the pipeline that produced it. */
  it('uses the lecturer\'s words, not the backend\'s', () => {
    const all = ['indexed', 'indexing', 'failed', 'pending'].flatMap((index_status) =>
      ['ready', 'failed', 'retiring', undefined].map((overlay_status) =>
        batchFileStatusLabel(file({ index_status, overlay_status } as Partial<BatchFile>)),
      ),
    )
    for (const label of all) {
      expect(label).not.toMatch(/overlay|durable|immediate/i)
    }
  })
})
