import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { ListChecks, X } from 'lucide-react'
import type { RunUiState } from '../../pages/chat/runTypes'
import { RunDetails } from '../../pages/chat/components/run/RunDetails'
import { Button } from '../../design-system'

/** Entering: the slide, the scrim, and the steps dropping down after it. */
const PANEL_IN_MS = 300
/**
 * Leaving. Shorter, and on `ease-in` rather than `ease-out` — the file's own
 * convention (`index.css`: "200ms for something leaving on
 * cubic-bezier(0.4, 0, 1, 1)"), which these panels were not following. An exit
 * should accelerate away: a thing that is leaving should not ask for as much
 * attention as a thing that just arrived, and easing *out* of the screen holds
 * it longest at the moment it is least interesting.
 */
const PANEL_OUT_MS = 200

/**
 * The steps a finished run carried out, in a right-side panel.
 *
 * It used to appear fully formed: the portal mounted and the drawer was simply
 * there, over a scrim that was simply there. This is the same two-phase mount
 * the composer's "Previous attachments" panel uses — render, then flip a
 * `visible` flag on the next frame so the browser has a from-state to
 * transition out of — with the same 300ms ease-out slide and scrim fade.
 * Closing plays it backwards before unmounting, which the old version could not
 * do at all.
 *
 * The steps then drop down inside it rather than being there on arrival. Two
 * beats, in the order they make sense: the panel gets a place to put them, then
 * they arrive. Firing both at once reads as one lurch.
 *
 * No thinking here, despite the old label promising it. `ThinkingPanel` returns
 * null for a settled run by design — thinking is a liveness signal, not a
 * record, and the steps are the record — so "View steps & thinking" opened onto
 * steps and nothing else. The label now says what it does.
 */
export function RunInspector({
  run,
  label = 'View steps',
}: {
  run: RunUiState
  label?: string
}) {
  const [open, setOpen] = useState(false)
  const [rendered, setRendered] = useState(false)
  const [visible, setVisible] = useState(false)
  const [stepsOpen, setStepsOpen] = useState(false)

  useEffect(() => {
    if (open) {
      setRendered(true)
      // Next frame, so the panel has a from-state to slide out of rather than
      // being painted in its final position.
      const frame = requestAnimationFrame(() => setVisible(true))
      // And the steps once it has arrived, so the two motions read as a
      // sequence instead of a single lurch.
      const steps = window.setTimeout(() => setStepsOpen(true), PANEL_IN_MS)
      return () => {
        cancelAnimationFrame(frame)
        window.clearTimeout(steps)
      }
    }
    setVisible(false)
    setStepsOpen(false)
    const timer = window.setTimeout(() => setRendered(false), PANEL_OUT_MS)
    return () => window.clearTimeout(timer)
  }, [open])

  useEffect(() => {
    if (!rendered) return undefined
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
  }, [rendered])

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        onClick={() => setOpen(true)}
        aria-expanded={open}
        leadingIcon={<ListChecks className="h-4 w-4" />}
      >
        {label}
      </Button>
      {rendered &&
        createPortal(
          <div
            className={`fixed inset-0 z-[200] flex justify-end transition-colors ${
              visible ? 'bg-slate-950/40 backdrop-blur-sm duration-300' : 'bg-transparent duration-200'
            }`}
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setOpen(false)
            }}
          >
            <aside
              className={`flex h-full w-full max-w-md flex-col overflow-hidden bg-white shadow-2xl transition-transform ${
                visible
                  ? 'translate-x-0 duration-300 ease-out'
                  : 'translate-x-full duration-200 ease-in'
              }`}
              role="dialog"
              aria-modal="true"
              aria-label="Run details"
            >
              <header className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">Run details</h2>
                  <p className="text-xs text-slate-500">The steps taken for this generation.</p>
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-full p-2 text-slate-500 transition-colors hover:bg-slate-100"
                  aria-label="Close run details"
                >
                  <X className="h-5 w-5" />
                </button>
              </header>
              <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
                {/* `grid-template-rows` named explicitly rather than
                    `transition-all`: the panel around it animates a transform,
                    and `all` is how unrelated properties end up sharing a
                    timing nobody chose for them. */}
                <div
                  className="grid transition-[grid-template-rows] duration-300 ease-out"
                  style={{ gridTemplateRows: stepsOpen ? '1fr' : '0fr' }}
                >
                  <div className="overflow-hidden">
                    {/* Expanded already: the panel's own control promised the
                        steps, and a second tap to reach them asks twice. */}
                    <RunDetails run={run} isFinal defaultOpen />
                  </div>
                </div>
              </div>
            </aside>
          </div>,
          document.body,
        )}
    </>
  )
}
