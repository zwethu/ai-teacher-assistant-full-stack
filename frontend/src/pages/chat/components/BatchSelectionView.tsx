import type { Batch } from '../../../entity/Batch'
import { ChevronRight, Loader2, Sparkles } from 'lucide-react'

type Props = {
  batches: Batch[]
  batchesLoading: boolean
  onSelectBatch: (batch: Batch) => void
}

export function BatchSelectionView({ batches, batchesLoading, onSelectBatch }: Props) {
  return (
    <div className="flex flex-col items-center justify-center flex-1 text-center px-4 py-20">
      <div className="w-14 h-14 rounded-2xl bg-white/50 border border-white/60 shadow-lg flex items-center justify-center mb-6">
        <Sparkles className="w-7 h-7 text-emerald-600" />
      </div>
      <h2 className="text-2xl font-semibold text-slate-800 mb-2">AI Teaching Assistant</h2>
      <p className="text-slate-500 text-sm max-w-sm mb-8">
        Choose a batch to start chatting about lesson plans, assessments, and more.
      </p>
      {batchesLoading ? (
        <Loader2 className="w-6 h-6 text-emerald-600 animate-spin" />
      ) : (
        <div className="w-full max-w-sm space-y-2">
          {batches.map((batch) => (
            <button
              key={batch.id}
              type="button"
              onClick={() => onSelectBatch(batch)}
              className="w-full flex items-start gap-3 p-4 rounded-xl bg-white/60 border border-white/60 shadow-sm hover:bg-white/80 hover:shadow-md transition-all text-left"
            >
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-slate-800 truncate">{batch.batch_name}</div>
                <div className="text-xs text-slate-500 truncate">
                  {batch.course_name}
                  {batch.academic_year ? ` · ${batch.academic_year}` : ''}
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-slate-400 mt-0.5 flex-shrink-0" />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
