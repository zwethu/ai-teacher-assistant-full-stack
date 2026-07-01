import { describe, expect, it } from 'vitest'
import type { BatchFile } from '../../../entity/File'
import { batchFileStatusLabel } from './MaterialsTab'

const base = { index_status: 'indexing', overlay_status: 'ready' } as BatchFile

describe('batch file composite status', () => {
  it('describes immediate readiness while indexing', () => {
    expect(batchFileStatusLabel(base)).toContain('Ready for immediate use')
  })
  it('describes grace retention and failures', () => {
    expect(batchFileStatusLabel({ ...base, index_status: 'indexed', overlay_status: 'retiring' })).toContain('retained temporarily')
    expect(batchFileStatusLabel({ ...base, index_status: 'failed' })).toContain('Durable indexing failed')
    expect(batchFileStatusLabel({ ...base, overlay_status: 'failed' })).toContain('Immediate preview failed')
  })
})
