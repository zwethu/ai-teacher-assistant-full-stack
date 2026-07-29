import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { ListChecks, X } from 'lucide-react'
import type { RunUiState } from '../../pages/chat/runTypes'
import { RunDetails } from '../../pages/chat/components/run/RunDetails'
import { ThinkingPanel } from '../../pages/chat/components/run/ThinkingPanel'

/**
 * A tap-to-open right-side drawer exposing the steps and thinking the agent
 * carried out for a finished run. Keeps that detail out of the main workflow
 * view (which shows thinking only while generating) but available on demand.
 */
export function RunInspector({
  run,
  label = 'View steps & thinking',
}: {
  run: RunUiState
  label?: string
}) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = previous
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
      >
        <ListChecks className="h-3.5 w-3.5" />
        {label}
      </button>
      {open &&
        createPortal(
          <div
            className="fixed inset-0 z-[200] flex justify-end bg-slate-950/40 backdrop-blur-sm"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setOpen(false)
            }}
          >
            <aside className="flex h-full w-full max-w-md flex-col overflow-hidden bg-white shadow-2xl">
              <header className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">Run details</h2>
                  <p className="text-xs text-slate-500">Steps and thinking for this generation.</p>
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-full p-2 text-slate-500 hover:bg-slate-100"
                  aria-label="Close run details"
                >
                  <X className="h-5 w-5" />
                </button>
              </header>
              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-5">
                <RunDetails run={run} isFinal />
                <ThinkingPanel events={run.events} runStatus={run.status} />
              </div>
            </aside>
          </div>,
          document.body,
        )}
    </>
  )
}
