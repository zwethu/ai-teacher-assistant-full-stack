import { useEffect, useMemo, useState } from 'react'
import type { Batch } from '../entity/Batch'
import { listBatches } from '../services/batchService'
import { useAuth } from './useAuth'

/**
 * Shared batch ("space") selection for standalone generation surfaces.
 *
 * Selecting a batch is what wires generation context: the batch's datastore_id
 * flows through the agent run so Course-Space (Vertex Search) files are searched
 * automatically — exactly like chat. Every standalone generation page requires a
 * selected batch (attachments are optional; the space is not).
 */
export function useBatchSelection(initialBatchId?: string) {
  const { user } = useAuth()
  const [batches, setBatches] = useState<Batch[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(initialBatchId ?? null)

  useEffect(() => {
    if (!user) return
    let cancelled = false
    setLoading(true)
    listBatches()
      .then((data) => {
        if (cancelled) return
        setBatches(data)
        setSelectedBatchId((current) => current ?? data[0]?.id ?? null)
      })
      .catch(console.error)
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [user])

  const selectedBatch = useMemo(
    () => batches.find((batch) => batch.id === selectedBatchId) ?? null,
    [batches, selectedBatchId],
  )

  return { batches, loading, selectedBatch, selectedBatchId, setSelectedBatchId }
}
