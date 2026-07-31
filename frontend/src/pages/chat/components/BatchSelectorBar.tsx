import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronDown } from 'lucide-react'
import type { Batch } from '../../../entity/Batch'
import { BatchMenuList } from './BatchMenuList'

type Props = {
  batches: Batch[]
  batchesLoading: boolean
  onSelectBatch: (batch: Batch) => void
}

/** The "pick a space" chip above the composer. It exists only for the empty
    state — once a space is chosen, the header names it and owns switching. */
export function BatchSelectorBar({ batches, batchesLoading, onSelectBatch }: Props) {
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
      : 'Select a batch'

  return (
    <div ref={containerRef} className="relative px-4 pb-2 flex-shrink-0">
      <div className="max-w-3xl mx-auto flex items-center gap-2">
        <button
          type="button"
          onClick={handleChipClick}
          /* pointer-events-auto: the composer wrapper this sits in floats over
             the transcript and disables pointer events, so only the controls
             themselves take clicks — the rest of the band stays see-through. */
          /* violet-900, not slate: white/70 over the page's purple canvas
             composites to a lavender, and neutral gray reads muddy on it. */
          className="pointer-events-auto inline-flex items-center gap-2 rounded-full border border-violet-200/70 bg-white/70 px-3 py-1.5 text-sm font-medium text-violet-900 transition-colors hover:bg-violet-50/60 active:scale-[0.97]"
          aria-expanded={open}
        >
          <span className="truncate max-w-[220px]">{chipLabel}</span>
          {batches.length > 0 && (
            <ChevronDown
              className={`h-4 w-4 flex-none text-violet-500 transition-transform duration-200 ${
                open ? 'rotate-180' : ''
              }`}
            />
          )}
        </button>
      </div>

      {open && batches.length > 0 && (
        <div className="pointer-events-auto absolute left-4 right-4 bottom-full mb-1 max-w-sm mx-auto rounded-xl border border-slate-200 bg-white shadow-lg z-30 overflow-hidden">
          <BatchMenuList
            batches={batches}
            onSelect={(batch) => {
              onSelectBatch(batch)
              setOpen(false)
            }}
          />
        </div>
      )}
    </div>
  )
}
