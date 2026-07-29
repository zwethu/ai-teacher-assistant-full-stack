import { ExternalLink, Sparkles } from 'lucide-react'
import { Button } from '../../../design-system'

type Props = {
  onGoToBatches: () => void
}

export function NoBatchesView({ onGoToBatches }: Props) {
  return (
    <div className="flex flex-col items-center justify-center flex-1 text-center px-4 py-20">
      <div className="w-14 h-14 rounded-2xl bg-white/50 border border-white/60 shadow-lg flex items-center justify-center mb-6">
        <Sparkles className="w-7 h-7 text-violet-600" />
      </div>
      <h2 className="text-2xl font-semibold text-slate-800 mb-2">No batches yet</h2>
      <p className="text-slate-500 text-sm max-w-sm mb-6">
        Create a batch first to start chatting with your AI teaching assistant.
      </p>
      <Button type="button" onClick={onGoToBatches}>
        <ExternalLink className="w-4 h-4" />
        Go to Batches
      </Button>
    </div>
  )
}
