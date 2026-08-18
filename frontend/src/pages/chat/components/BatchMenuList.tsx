import type { Batch } from '../../../entity/Batch'

type Props = {
  batches: Batch[]
  selectedBatchId?: string | null
  onSelect: (batch: Batch) => void
}

/** The batch list itself, shared by the header switcher and the composer
    picker so the two cannot drift apart. Callers own the surface around it. */
export function BatchMenuList({ batches, selectedBatchId, onSelect }: Props) {
  return (
    <div className="max-h-56 overflow-y-auto py-1">
      {batches.map((batch) => (
        <button
          key={batch.id}
          type="button"
          onClick={() => onSelect(batch)}
          className={`w-full text-left px-4 py-2.5 text-sm transition-colors hover:bg-violet-50/60 ${
            selectedBatchId === batch.id ? 'text-violet-700 font-medium' : 'text-slate-700'
          }`}
        >
          <div className="truncate">{batch.batch_name}</div>
          <div className="text-xs text-slate-500 truncate">{batch.course_name}</div>
        </button>
      ))}
    </div>
  )
}
