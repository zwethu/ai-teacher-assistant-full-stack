import { BookOpenCheck } from 'lucide-react'
import { PlanningTab } from './batches/components/PlanningTab'
import { useBatchSelection } from '../hooks/useBatchSelection'
import { SelectField } from '../components/ui/SelectField'
import { Spinner } from '../design-system'

/**
 * Dedicated Course Plan surface.
 *
 * This deliberately embeds the batch PlanningTab instead of duplicating its
 * workflow. Creating, editing, archiving, browsing history, and restoring a
 * version therefore behave identically whether the lecturer enters through a
 * batch or through the sidebar.
 */
export default function CoursePlans() {
  const {
    batches,
    loading,
    selectedBatch,
    selectedBatchId,
    setSelectedBatchId,
  } = useBatchSelection()

  const batchOptions = batches.map((batch) => ({
    value: batch.id,
    label: batch.batch_name,
    hint: batch.course_name,
  }))

  return (
    <div className="pb-8">
      <div className="mb-6">
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-slate-800">
          <BookOpenCheck className="h-6 w-6 text-violet-600" />
          Course Plans
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Create and manage the course plan for each batch.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Spinner size={32} />
        </div>
      ) : batches.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white/60 px-6 py-14 text-center">
          <h2 className="font-semibold text-slate-800">No batches yet</h2>
          <p className="mt-2 text-sm text-slate-500">
            Create a batch before creating its Course Plan.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="max-w-xl rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <SelectField
              label="Batch"
              value={selectedBatchId ?? ''}
              onChange={setSelectedBatchId}
              options={batchOptions}
              placeholder="Select a batch"
            />
          </div>

          {selectedBatch && <PlanningTab key={selectedBatch.id} batchId={selectedBatch.id} />}
        </div>
      )}
    </div>
  )
}
