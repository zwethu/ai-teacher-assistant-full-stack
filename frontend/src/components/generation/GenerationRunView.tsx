import { useEffect, useState, type ReactNode } from 'react'
import { Info, Loader2, Pencil } from 'lucide-react'
import type { Batch } from '../../entity/Batch'
import type { GenerationRunState } from '../../hooks/useGenerationRun'
import {
  ArtifactExportButton,
  ArtifactPreviewCard,
  BlueprintSaveButton,
  OutlineApprovalCard,
} from '../../pages/chat/components/MessageRow'
import { ThinkingPanel } from '../../pages/chat/components/run/ThinkingPanel'
import { deriveGenerationStage } from './generationStage'
import { GenerationStepper } from './GenerationStepper'
import { RefineField } from './RefineField'
import { RunInspector } from './RunInspector'
import { ACCENT, type GenAccent } from './generationTheme'

/**
 * Non-chat renderer for a single generation run. Presents the workflow as
 * stages (draft outline → review → full preview → done) rather than a
 * conversation: no avatars, no message bubbles, no persistent composer. Reuses
 * the artifact/outline/export cards (shared with chat) but frames them as a
 * workflow, with steps + thinking tucked behind a tap once generating is done.
 */
export function GenerationRunView({
  batch,
  run,
  accent = 'emerald',
  emptyHint,
  onBlueprintSaved,
}: {
  batch: Batch
  run: GenerationRunState
  accent?: GenAccent
  emptyHint?: ReactNode
  onBlueprintSaved?: (version: number | null) => void
}) {
  const { stage, activeMessage, runState } = deriveGenerationStage(run)
  const theme = ACCENT[accent]

  // Refine box open state, reset whenever the stage changes (e.g. after a refine
  // kicks off a new run) so it never lingers into the next step.
  const [refineOpen, setRefineOpen] = useState(false)
  useEffect(() => {
    setRefineOpen(false)
  }, [stage])

  const generating = stage === 'generating_outline' || stage === 'generating_full'
  const heading =
    stage === 'generating_full'
      ? 'Generating the full preview…'
      : run.activePhase === 'refine'
        ? 'Applying your changes…'
        : 'Drafting the outline…'

  const refineTrigger = (label: string) => (
    <button
      type="button"
      onClick={() => setRefineOpen((open) => !open)}
      className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium ${
        refineOpen
          ? `${theme.softBg} ${theme.softBorder} ${theme.text}`
          : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
      }`}
    >
      <Pencil className="h-3.5 w-3.5" />
      {label}
    </button>
  )

  return (
    <div className="flex flex-col">
      <div className="sticky top-0 z-10 border-b border-slate-100 bg-white px-5 pb-3 pt-5">
        <GenerationStepper stage={stage} accent={accent} />
      </div>

      <div className="px-5 pb-5 pt-4">
        {stage === 'idle' && (
          <div className="py-10 text-center text-sm text-slate-400">
            {emptyHint ?? 'Fill in the form and click Generate to start.'}
          </div>
        )}

        {generating && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium text-slate-600">
              <Loader2 className={`h-4 w-4 animate-spin ${theme.text}`} />
              {heading}
            </div>
            {runState && (
              <ThinkingPanel
                events={runState.events}
                runStatus={runState.status}
                expandable={false}
              />
            )}
            <div className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-xs ${theme.softBorder} ${theme.softBg} ${theme.text}`}>
              <Info className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
              <span>
                Feel free to switch tabs or leave this page — generation keeps running in the
                background. Come back anytime and you'll see the progress right here.
              </span>
            </div>
          </div>
        )}

        {stage === 'outline_review' && activeMessage && (
          <div className="space-y-3">
            <OutlineApprovalCard
              msg={activeMessage}
              disabled={run.sending}
              completed={false}
              superseded={false}
              onApprove={() => run.approveOutline(activeMessage)}
            />
            <div className="flex flex-wrap items-center gap-2">
              {runState && <RunInspector run={runState} />}
              {refineTrigger('Request outline changes')}
            </div>
            <RefineField
              accent={accent}
              disabled={run.sending}
              open={refineOpen}
              onClose={() => setRefineOpen(false)}
              placeholder="e.g. add a hands-on activity in week 2, shorten the lecture to 20 minutes…"
              onSubmit={(text) => run.sendFollowUp(text)}
            />
          </div>
        )}

        {(stage === 'preview' || stage === 'done') && activeMessage && (
          <div className="space-y-3">
            <ArtifactPreviewCard content={activeMessage.content} metadata={activeMessage.metadata || {}} />
            <ArtifactExportButton batchId={batch.id} msg={activeMessage} />
            <BlueprintSaveButton batchId={batch.id} msg={activeMessage} onSaved={onBlueprintSaved} />
            <div className="flex flex-wrap items-center gap-2 pt-1">
              {runState && <RunInspector run={runState} />}
              {stage === 'preview' && refineTrigger('Refine this draft')}
            </div>
            {stage === 'preview' && (
              <RefineField
                accent={accent}
                disabled={run.sending}
                open={refineOpen}
                onClose={() => setRefineOpen(false)}
                placeholder="Ask for changes to the generated draft…"
                onSubmit={(text) => run.sendFollowUp(text)}
              />
            )}
          </div>
        )}

        {stage === 'failed' && (
          <div className="space-y-3">
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              The generation run failed before finishing. Adjust the form and generate again.
            </div>
            {runState && <RunInspector run={runState} />}
          </div>
        )}
      </div>
    </div>
  )
}
