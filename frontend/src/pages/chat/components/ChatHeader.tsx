import type { Batch } from '../../../entity/Batch'
import { ChevronLeft, ChevronRight } from 'lucide-react'

type Props = {
  selectedBatch: Batch
  sidebarOpen: boolean
  onBack: () => void
  onToggleSidebar: () => void
}

export function ChatHeader({ selectedBatch, sidebarOpen, onBack, onToggleSidebar }: Props) {
  return (
    <header className="relative z-10 flex-shrink-0 h-14 px-4 flex items-center gap-3 backdrop-blur-xl bg-white/20 border-b border-white/40">
      <button
        type="button"
        onClick={onBack}
        className="p-1.5 rounded-lg hover:bg-white/50 text-slate-500 hover:text-slate-700 transition-colors"
        aria-label="Back to batch selection"
      >
        <ChevronLeft className="w-5 h-5" />
      </button>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-slate-800 truncate">{selectedBatch.batch_name}</div>
        <div className="text-xs text-slate-500 truncate">{selectedBatch.course_name}</div>
      </div>
      <button
        type="button"
        onClick={onToggleSidebar}
        className="p-1.5 rounded-lg hover:bg-white/50 text-slate-500 hover:text-slate-700 transition-colors"
        aria-label={sidebarOpen ? 'Close sidebar' : 'Open sidebar'}
      >
        {sidebarOpen ? <ChevronRight className="w-5 h-5" /> : <ChevronLeft className="w-5 h-5" />}
      </button>
    </header>
  )
}
