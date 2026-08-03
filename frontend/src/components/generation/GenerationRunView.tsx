import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Info, Pencil, Plus, Square, Trash2, X } from 'lucide-react'
import type { Batch } from '../../entity/Batch'
import type { GenerationRunState } from '../../hooks/useGenerationRun'
import {
  ArtifactExportButton,
  ArtifactPreviewCard,
  BlueprintSaveButton,
  GameCreateButton,
  OutlineApprovalCard,
} from '../../pages/chat/components/MessageRow'
import { RunDetails } from '../../pages/chat/components/run/RunDetails'
import { ThinkingPanel } from '../../pages/chat/components/run/ThinkingPanel'
import { useStickToBottom } from '../../hooks/useStickToBottom'
import { deriveGenerationStage, isWorkflowSettled } from './generationStage'
import { GenerationStepper } from './GenerationStepper'
import { RefineField } from './RefineField'
import { RunInspector } from './RunInspector'
import type { GenAccent } from './generationTheme'
import { Button, Spinner } from '../../design-system'
import { useDismissibleHint } from '../../hooks/useDismissibleHint'

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
  accent = 'primary',
  emptyHint,
  onDiscard,
  onGenerateAnother,
  onBlueprintSaved,
  gameDeadlineAt,
  onGameCreated,
}: {
  batch: Batch
  run: GenerationRunState
  accent?: GenAccent
  emptyHint?: ReactNode
  /**
   * Abandon the workflow and go back to the form.
   *
   * Rendered in one fixed place — the card's own footer, bottom right —
   * rather than above the card or scattered through each stage.
   *
   * The header was correct in principle and useless in practice: a generated
   * outline runs well past a screen, so the one way out sat above the fold
   * while the lecturer read to the bottom and found only Approve and Request
   * changes. Per-stage rows fixed the distance and cost the predictability —
   * the exit moved depending on what the run happened to be doing.
   */
  onDiscard?: () => void
  /** The settled twin of `onDiscard`, in the same slot. */
  onGenerateAnother?: () => void
  onBlueprintSaved?: (version: number | null) => void
  /** Deadline chosen on the game form, applied when the staged game is created. */
  gameDeadlineAt?: string | null
  /** Fires once the staged game actually exists, so a host page holding a list
   *  of games can refresh. Without it the page that owns the list has no idea
   *  the run produced anything. */
  onGameCreated?: () => void
}) {
  const { stage, activeMessage, runState } = deriveGenerationStage(run)

  // Refine box open state, reset whenever the stage changes (e.g. after a refine
  // kicks off a new run) so it never lingers into the next step.
  const [refineOpen, setRefineOpen] = useState(false)
  // The live step list is bounded here in a way it is not in chat — see the
  // capped region below — so it needs its own bottom pin.
  const stepsScrollRef = useRef<HTMLDivElement | null>(null)
  const stepsContentRef = useRef<HTMLDivElement | null>(null)
  useStickToBottom(stepsScrollRef, stepsContentRef)
  const backgroundHint = useDismissibleHint('generation-runs-in-background')
  useEffect(() => {
    setRefineOpen(false)
  }, [stage])

  const generating = stage === 'generating_outline' || stage === 'generating_full'
  const settled = isWorkflowSettled(stage)
  // The stages that already draw a row of actions for the exit to join.
  const hasActionRow =
    stage === 'outline_review' || stage === 'preview' || stage === 'done'

  // Terminal actions report their result back into the run so the stepper can
  // reach its final step without waiting for a remount to re-read Firestore.
  const deliver = (patch: Record<string, unknown>) => {
    if (activeMessage?.message_id) run.markArtifactDelivered(activeMessage.message_id, patch)
  }

  /* Same weight as the inspector's trigger beside it: these two are the whole
     set of things a lecturer can do with a finished result, and they were the
     smallest controls on the card. The accent tint that used to mark the open
     state is gone rather than fought for — a Tailwind background cannot beat
     the design system's own unlayered button rule anyway, and the field
     appearing below is the clearer feedback. `aria-expanded` carries it for
     anyone who cannot see that. */
  const refineTrigger = (label: string) => (
    <Button
      type="button"
      variant="secondary"
      aria-expanded={refineOpen}
      onClick={() => setRefineOpen((open) => !open)}
      leadingIcon={<Pencil className="h-4 w-4" />}
    >
      {label}
    </Button>
  )

  /* The card's one fixed exit, bottom right.
     ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄
     Same corner at every stage: Discard while there is a draft to abandon,
     Generate another once the work is saved. The stage's own actions —
     Approve, Refine, View steps — stay where they are; this is the way *out*,
     and a way out that moves is one the lecturer has to look for.

     Not a danger colour. Nothing has been saved at any stage that offers
     Discard, so the risk is losing a draft rather than deleting work. */
  const exitControl = settled ? (
    onGenerateAnother ? (
      /* Primary. Once the work is saved this is the only thing left to do on
         the page, and it was reading as another quiet option beside View steps
         and Open Google Doc — three secondary buttons in a row, none of them
         claiming to be the next step. Discard stays the quietest thing in the
         card: they share a corner, and only one of them is an invitation. */
      <Button
        type="button"
        variant="primary"
        onClick={onGenerateAnother}
        leadingIcon={<Plus className="h-4 w-4" />}
      >
        Generate another
      </Button>
    ) : null
  ) : onDiscard ? (
    /* The design system's own ghost, not a hand-rolled button that resembles
       one. The hand-rolled version set its own padding and min-height, so the
       icon and the label were centred against different boxes and sat a pixel
       or two apart — and it stood at a different height from the two real
       Buttons beside it in the row. `.maia-btn` centres both on one flex line
       and matches its neighbours by construction. */
    <Button type="button" variant="ghost" onClick={onDiscard} leadingIcon={<Trash2 className="h-4 w-4" />}>
      Discard
    </Button>
  ) : null

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Stop lives with the stepper, not under the steps. It is the only
          action available while a run is going, and down in the body it sat
          below a scrolling list — small, low-contrast, and pushed further away
          by every step that arrived. Here it is full button size, and the
          header is sticky, so it cannot be scrolled out of reach. */}
      <div className="sticky top-0 z-10 flex items-center gap-4 border-b border-slate-100 bg-white px-5 pb-3 pt-5">
        <div className="min-w-0 flex-1">
          <GenerationStepper stage={stage} accent={accent} />
        </div>
        {generating && (
          <Button
            type="button"
            variant="secondary"
            onClick={() => void run.cancelRun()}
            disabled={run.cancelling}
            className="flex-shrink-0"
            /* Secondary, not danger: stopping is a deliberate choice, not a
               destructive one to be warned away from. Not primary either —
               solid violet would read as "do this next". */
            leadingIcon={
              run.cancelling ? (
                <Spinner size={16} tone="muted" />
              ) : (
                <Square className="h-3.5 w-3.5 fill-current" />
              )
            }
          >
            {run.cancelling ? 'Stopping' : 'Stop generating'}
          </Button>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col px-5 pb-5 pt-4">
        {stage === 'idle' && (
          <div className="py-10 text-center text-sm text-slate-400">
            {emptyHint ?? 'Fill in the form and click Generate to start.'}
          </div>
        )}

        {generating && (
          <div className="flex min-h-0 flex-1 flex-col gap-3">
            {/* No status heading and no loading spinner here: the stepper above
                already names the phase, and the thinking line is the one live
                element. Two competing "we're working" animations read as noise. */}
            {/* `expandable` is gone — the panel is never expandable now, here
                or in chat, which is what this call site already wanted. */}
            {runState && <ThinkingPanel events={runState.events} runStatus={runState.status} />}
            {/* Steps under the thinking line, same order as chat: the line is
                the fixed liveness signal, the steps are the detail that changes
                under it.

                Sized by what is left, not by a number. In chat the transcript
                is the scroll container and a fan-out just makes the page
                longer; here the run sits in a card, so the list has to be
                bounded. It was bounded at a flat `max-h-48`, which knew nothing
                about the notice below it — so once the steps ran long the last
                row was clipped hard against copy that had every right to be
                there, and read as covered rather than as scrollable.

                `flex-1 min-h-0` inside a flex column takes exactly the height
                the thinking line above and the notice below have not claimed.
                The two can no longer collide, whatever the card's height turns
                out to be, and a partly visible row at the fold is then an
                honest signal that there is more.

                Pinned to the bottom by the same hook the transcript uses, so
                the newest work stays in view as rows arrive and settle. */}
            {runState && (
              <div ref={stepsScrollRef} className="min-h-0 flex-1 overflow-y-auto">
                <div ref={stepsContentRef}>
                  <RunDetails run={runState} isFinal={false} />
                </div>
              </div>
            )}
            {/* Last in the card and the quietest thing in it — a footnote, not
                a banner. It was a full-width tinted band saying the same two
                sentences on every run, which is how a notice teaches people to
                stop reading that part of the card. Dismissing it is permanent:
                it is a fact about how the product works, true once and
                furniture thereafter. */}
            {backgroundHint.visible && (
              <div className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                <Info className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-slate-400" />
                <span className="min-w-0 flex-1">
                  Generation keeps running if you leave this page — come back any time.
                </span>
                <button
                  type="button"
                  onClick={backgroundHint.dismiss}
                  aria-label="Don't show this again"
                  className="-mr-1 -mt-0.5 flex-shrink-0 rounded p-1 text-slate-400 transition-colors hover:bg-slate-200/70 hover:text-slate-700"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
          </div>
        )}

        {stage === 'cancelled' && (
          <div className="space-y-3">
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
              Request cancelled. Nothing was saved — adjust the form and generate again.
            </div>
            {runState && <RunInspector run={runState} />}
          </div>
        )}

        {stage === 'outline_review' && activeMessage && (
          <div className="space-y-3">
            {/* One card, one action: here "the run is in flight" and "this
                approval is in flight" are the same fact, so `generating`
                tracks `sending` directly. Chat has to be more careful. */}
            <OutlineApprovalCard
              msg={activeMessage}
              disabled={run.sending}
              generating={run.sending}
              completed={
                String(activeMessage.metadata?.outline_approval_status || '') === 'approved'
              }
              superseded={
                String(activeMessage.metadata?.outline_approval_status || '') === 'superseded'
              }
              onApprove={() => run.approveOutline(activeMessage)}
            />
            {/* One row. The exit belongs beside View steps and Request
                changes rather than under them — it is one of the three things
                the lecturer can do here, and a row of its own made it read as
                a separate decision about the page instead of about the run. */}
            <div className="flex flex-wrap items-center gap-2">
              {runState && <RunInspector run={runState} />}
              {refineTrigger('Request outline changes')}
              {exitControl && <span className="ml-auto">{exitControl}</span>}
            </div>
            <RefineField
              accent={accent}
              disabled={run.sending}
              open={refineOpen}
              onClose={() => setRefineOpen(false)}
              placeholder="e.g. add a hands-on activity in week 2, shorten the lecture to 20 minutes…"
              onSubmit={(text) => run.sendFollowUp(text, activeMessage)}
            />
          </div>
        )}

        {(stage === 'preview' || stage === 'done') && activeMessage && (
          <div className="space-y-3">
            <ArtifactPreviewCard content={activeMessage.content} metadata={activeMessage.metadata || {}} />
            <ArtifactExportButton batchId={batch.id} msg={activeMessage} onDelivered={deliver} />
            <BlueprintSaveButton
              batchId={batch.id}
              msg={activeMessage}
              onSaved={onBlueprintSaved}
              onDelivered={deliver}
            />
            <GameCreateButton
              batchId={batch.id}
              msg={activeMessage}
              // `deliver` keeps the stepper honest; `onGameCreated` tells the host
              // page the game now exists. Both matter: without the second, the
              // page can say "Game created" and "No games yet" at the same time.
              onDelivered={(patch) => {
                deliver(patch)
                onGameCreated?.()
              }}
              deadlineAt={gameDeadlineAt}
            />
            {/* Refining a generated draft is a gated refine_full invoke keyed on
                the card's approved_outline_run_id — single-shot cards (game)
                have none, so they get no refine affordance rather than a
                follow-up the generation gate would refuse. */}
            {(() => {
              const canRefineDraft = Boolean(
                activeMessage.metadata?.approved_outline_run_id,
              )
              return (
                <>
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    {runState && <RunInspector run={runState} />}
                    {stage === 'preview' && canRefineDraft && refineTrigger('Refine this draft')}
                    {exitControl && <span className="ml-auto">{exitControl}</span>}
                  </div>
                  {stage === 'preview' && canRefineDraft && (
                    <RefineField
                      accent={accent}
                      disabled={run.sending}
                      open={refineOpen}
                      onClose={() => setRefineOpen(false)}
                      placeholder="Ask for changes to the generated draft…"
                      onSubmit={(text) => run.sendFollowUp(text, activeMessage)}
                    />
                  )}
                </>
              )
            })()}
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

        {/* Only where there is no action row to join: mid-generation, idle,
            cancelled and failed have nothing else to sit beside. */}
        {exitControl && !hasActionRow && (
          <div className="mt-4 flex justify-end">{exitControl}</div>
        )}
      </div>
    </div>
  )
}
