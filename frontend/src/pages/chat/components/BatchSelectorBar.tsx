import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronDown, X } from 'lucide-react'
import type { Batch } from '../../../entity/Batch'

type Props = {
  batches: Batch[]
  batchesLoading: boolean
  selectedBatch: Batch | null
  onSelectBatch: (batch: Batch | null) => void
}

export function BatchSelectorBar({
  batches,
  batchesLoading,
  selectedBatch,
  onSelectBatch,
}: Props) {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  function handleChipClick() {
    if (!batchesLoading && batches.length === 0) {
      navigate('/batches')
      return
    }
    setOpen((v) => !v)
  }

  const chipLabel = batchesLoading
    ? 'Loading batches…'
    : batches.length === 0
      ? 'Create a batch →'
      : selectedBatch
        ? selectedBatch.batch_name
        : 'Select a batch'

  return (
    <div ref={containerRef} className="relative px-4 pb-2 flex-shrink-0">
      <div className="max-w-3xl mx-auto flex items-center gap-2">
        <button
          type="button"
          onClick={handleChipClick}
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium border border-emerald-200/70 bg-white/70 text-slate-700 hover:bg-emerald-50/60 transition-colors"
        >
          <span className="truncate max-w-[220px]">{chipLabel}</span>
          {batches.length > 0 && (
            <>
              {selectedBatch && (
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => {
                    e.stopPropagation()
                    onSelectBatch(null)
                    setOpen(false)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      e.stopPropagation()
                      onSelectBatch(null)
                      setOpen(false)
                    }
                  }}
                  className="p-0.5 rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-600"
                  aria-label="Clear batch selection"
                >
                  <X className="w-3.5 h-3.5" />
                </span>
              )}
              <ChevronDown className="w-4 h-4 text-slate-400" />
            </>
          )}
        </button>
      </div>

      {open && batches.length > 0 && (
        <div className="absolute left-4 right-4 top-full mt-1 max-w-sm mx-auto rounded-xl border border-slate-200 bg-white shadow-lg z-20 overflow-hidden">
          <div className="max-h-56 overflow-y-auto py-1">
            {batches.map((batch) => (
              <button
                key={batch.id}
                type="button"
                onClick={() => {
                  onSelectBatch(batch)
                  setOpen(false)
                }}
                className={`w-full text-left px-4 py-2.5 text-sm hover:bg-emerald-50/60 transition-colors ${
                  selectedBatch?.id === batch.id ? 'text-emerald-700 font-medium' : 'text-slate-700'
                }`}
              >
                <div className="truncate">{batch.batch_name}</div>
                <div className="text-xs text-slate-500 truncate">{batch.course_name}</div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
