import { ExternalLink, Sparkles } from 'lucide-react'

type Props = {
  onGoToBatches: () => void
}

export function NoBatchesView({ onGoToBatches }: Props) {
  return (
    <div className="flex flex-col items-center justify-center flex-1 text-center px-4 py-20">
      <div className="w-14 h-14 rounded-2xl bg-white/50 border border-white/60 shadow-lg flex items-center justify-center mb-6">
        <Sparkles className="w-7 h-7 text-emerald-600" />
      </div>
      <h2 className="text-2xl font-semibold text-slate-800 mb-2">No batches yet</h2>
      <p className="text-slate-500 text-sm max-w-sm mb-6">
        Create a batch first to start chatting with your AI teaching assistant.
      </p>
      <button
        type="button"
        onClick={onGoToBatches}
        className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium rounded-md text-white bg-emerald-600 hover:bg-emerald-700 shadow-sm"
      >
        <ExternalLink className="w-4 h-4" />
        Go to Batches
      </button>
    </div>
  )
}
