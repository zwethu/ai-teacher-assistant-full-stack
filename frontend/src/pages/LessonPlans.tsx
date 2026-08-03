import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { ChevronDown, ExternalLink, RefreshCw, Sparkles, Trash2 } from 'lucide-react'
import type { ToastMessage } from '../types'
import Toast from '../components/ui/Toast'
import { getErrorMessage } from '../utils/errors'
import { useBatchSelection } from '../hooks/useBatchSelection'
import { useWorkflowPrefill } from '../hooks/useWorkflowPrefill'
import { useGenerationRun } from '../hooks/useGenerationRun'
import { GenerationRunView } from '../components/generation/GenerationRunView'
import { deriveGenerationStage, isWorkflowSettled } from '../components/generation/generationStage'
import { GenerationAttachments } from '../components/generation/GenerationAttachments'
import { PlanHintBanner } from '../components/generation/PlanHintBanner'
import { deleteArtifact, listArtifacts, type Artifact } from '../services/artifactService'
import { timeAgo } from '../utils/formatDate'
import { artifactIcon } from '../utils/artifactIcons'
import { SelectField, toOptions } from '../components/ui/SelectField'
import { NumberField } from '../components/ui/NumberField'
import { Collapse } from '../components/ui/Collapse'
import { confirm } from '../components/ui/confirmStore'
import { undoable, usePendingUndo } from '../components/ui/undoStore'
import { FIELD_CLASS, FIELD_LABEL_CLASS, TEXTAREA_CLASS } from '../components/ui/fieldStyles'
import { Spinner } from '../design-system'

// Read from the shared table rather than named twice: the empty state used to
// draw a FileText while the card four lines below it drew a BookOpen.
const LessonPlanIcon = artifactIcon('lesson_plan')

const GRADES = ['Undergraduate Y1', 'Undergraduate Y2', 'Undergraduate Y3', 'Undergraduate Y4', 'Postgraduate']
const DURATIONS = [30, 45, 60, 90, 120, 180]
const DIFFICULTIES = ['easy', 'medium', 'hard']
const APPROACHES = ['inquiry-based', 'direct', 'project-based', 'mixed']
const PLAN_TYPES = [
  'standard', 'scenario_based', 'case_based', 'lab_based',
  'project_based', 'flipped', 'workshop_practice', 'review_remediation',
]

/* Values stay exactly as the agent prompt expects them; only the labels are
   dressed up. Difficulty used to be capitalised by a `capitalize` utility on
   the control, which the custom dropdown has no equivalent for — and doing it
   in the label is the honest place anyway, since it is a display concern. */
const DURATION_OPTIONS = toOptions(DURATIONS.map(String))
const GRADE_OPTIONS = toOptions(GRADES)
const DIFFICULTY_OPTIONS = toOptions(DIFFICULTIES, (d) => d[0].toUpperCase() + d.slice(1))
const APPROACH_OPTIONS = toOptions(APPROACHES)
const PLAN_TYPE_OPTIONS = toOptions(PLAN_TYPES, (t) => t.replace(/_/g, ' '))

const INITIAL_FORM = {
  title: '',
  topic: '',
  week: 1,
  grade: GRADES[0],
  duration: 60,
  difficulty: 'medium',
  approach: 'mixed',
  planType: 'standard',
  priorKnowledge: '',
  instructions: '',
}

function buildMessage(f: typeof INITIAL_FORM): string {
  const lines = [
    `Generate a lesson plan for week ${f.week}.`,
    // Standalone form already collected required fields — do not ask follow-up questions.
    'Standalone form submission: all required fields below are confirmed. Do not ask clarifying questions; proceed to begin_lesson_plan_workflow.',
  ]
  if (f.title.trim()) lines.push(`Preferred lesson plan title: ${f.title.trim()}`)
  else {
    lines.push(
      'Preferred lesson plan title: not specified — auto-name the lesson plan. If an active Course Plan exists, derive the title from that week\'s theme/goal; otherwise name it from the topic and course.',
    )
  }
  if (f.topic.trim()) lines.push(`Topic: ${f.topic.trim()}`)
  else {
    lines.push(
      'Topic: not specified — choose a suitable topic for this week from the active Course Plan week guidance if available; otherwise pick a suitable topic for the course.',
    )
  }
  lines.push(
    `Grade/level: ${f.grade}`,
    `Duration: ${f.duration} minutes`,
    `Difficulty: ${f.difficulty}`,
    `Teaching approach: ${f.approach}`,
    `Lesson plan type: ${f.planType}`,
    // Required: the agent's clarification gate blocks research until prior_knowledge
    // is present and specific, so this line is always sent.
    `Prior knowledge: ${f.priorKnowledge.trim()}`,
  )
  if (f.instructions.trim()) lines.push(`Additional instructions: ${f.instructions.trim()}`)
  lines.push(
    'If course_blueprint_status is active, you MUST reference the Course Plan (especially course_blueprint_week_plan) when choosing topic/title and aligning objectives.',
  )
  return lines.join('\n')
}

// Required inputs only — topic and additional instructions are optional, so a blank
// one never blocks generation.
function missingRequiredInputs(f: typeof INITIAL_FORM, hasBatch: boolean): string[] {
  const missing: string[] = []
  if (!hasBatch) missing.push('a space')
  if (!(Number(f.week) >= 1)) missing.push('a week number')
  if (!f.priorKnowledge.trim()) missing.push('prior knowledge')
  return missing
}

function joinReadable(items: string[]): string {
  if (items.length <= 1) return items[0] ?? ''
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

export default function LessonPlans() {
  const { batches, loading: batchesLoading, selectedBatch, selectedBatchId, setSelectedBatchId } =
    useBatchSelection()
  const run = useGenerationRun(selectedBatch, 'lesson_plan')

  const [form, setForm] = useState(INITIAL_FORM)
  const [toast, setToast] = useState<ToastMessage | null>(null)
  const [artifacts, setArtifacts] = useState<Artifact[]>([])
  const pendingUndo = usePendingUndo()
  // Starts true: nothing has been fetched yet, and `false` here reads as
  // "loaded, and there is nothing" — which is what raced the prefill.
  const [listLoading, setListLoading] = useState(true)
  const [showOptional, setShowOptional] = useState(false)
  const prefill = useWorkflowPrefill(selectedBatchId, listLoading ? null : artifacts)
  // Applied once per space, so re-selecting the same batch never overwrites
  // what the lecturer has typed since — and clearing a field on purpose is not
  // undone the moment anything else re-renders.
  const prefilledFor = useRef('')

  // Course name as the hint, so typing either it or the cohort finds the space.
  const batchOptions = useMemo(
    () => batches.map((b) => ({ value: b.id, label: b.batch_name, hint: b.course_name })),
    [batches],
  )

  useEffect(() => {
    if (!prefill || !selectedBatchId || prefilledFor.current === selectedBatchId) return
    prefilledFor.current = selectedBatchId
    setForm((current) => ({
      ...current,
      week: prefill.week,
      topic: current.topic || prefill.topic,
      priorKnowledge: current.priorKnowledge || prefill.priorKnowledge,
    }))
  }, [prefill, selectedBatchId])

  const showToast = useCallback((type: ToastMessage['type'], message: string) => {
    setToast({ type, message })
    window.setTimeout(() => setToast(null), 5000)
  }, [])


  /* Deleting from the standalone page, with the same confirm-then-undo the
     batch space uses — the artifact and its Drive file are the same object
     wherever it is reached from. */
  async function handleDeleteArtifact(artifact: Artifact) {
    const batchId = selectedBatchId
    if (!batchId) return
    const label = artifact.title || 'this lesson plan'
    const ok = await confirm({
      title: `Delete ${label}?`,
      body: 'This removes it from MILA and deletes the Google Doc.',
      confirmLabel: 'Delete',
      tone: 'danger',
    })
    if (!ok) return
    undoable({
      id: artifact.id,
      message: `Deleted ${label}.`,
      commit: async () => {
        try {
          await deleteArtifact(batchId, artifact.id, true)
          setArtifacts((prev) => prev.filter((entry) => entry.id !== artifact.id))
        } catch (err) {
          showToast('error', getErrorMessage(err, 'Could not delete it.'))
        }
      },
    })
  }

  /* Rows on their way out sit behind the undo window rather than being
     spliced away, so an undone card returns to its original position. */
  const visibleArtifacts = artifacts.filter((a) => !pendingUndo.has(a.id))

  const refreshArtifacts = useCallback(async (batchId: string) => {
    setListLoading(true)
    try {
      const data = await listArtifacts(batchId, { type: 'lesson_plan', current: true })
      setArtifacts(data)
    } catch (err) {
      console.error(err)
      showToast('error', getErrorMessage(err, 'Could not load lesson plans.'))
    } finally {
      setListLoading(false)
    }
  }, [showToast])

  useEffect(() => {
    if (selectedBatchId) {
      void refreshArtifacts(selectedBatchId)
      return
    }
    setArtifacts([])
    setListLoading(false)
  }, [selectedBatchId, refreshArtifacts])

  async function handleGenerate(e: FormEvent) {
    e.preventDefault()
    if (!selectedBatch || run.sending) return
    const blockers = missingRequiredInputs(form, true)
    if (blockers.length > 0) {
      showToast('error', `Add ${joinReadable(blockers)} before generating.`)
      return
    }
    await run.generate({
      workflowType: 'lesson_plan',
      message: buildMessage(form),
      week: Number(form.week) || 1,
      webSearch: true,
    })
  }

  // Keep the page form-first: the progress panel only appears once a run starts.
  /* Nothing is persisted as an artifact until the workflow finishes, so
     discarding costs only the draft. `cancelRun` first when something is
     genuinely in flight — `reset` alone would leave the backend generating
     into a run nobody is listening to. */
  const discardRun = useCallback(async () => {
    /* Still a dialog rather than an undo: there is no row to put back and no
       API call to hold, and un-cancelling a generation the backend has already
       stopped is not something the frontend can offer. */
    const ok = await confirm({
      title: 'Discard this draft?',
      body: 'Nothing has been saved, and you will start again from the form.',
      confirmLabel: 'Discard',
      tone: 'danger',
    })
    if (!ok) return
    if (run.currentRunId) void run.cancelRun()
    run.reset()
  }, [run])

  const stage = deriveGenerationStage(run).stage
  const settled = isWorkflowSettled(stage)

  /* The list is live now rather than hidden behind the run, so it has to pick
     up what the run just produced — otherwise a lecturer watches a generation
     finish above a list that still does not contain it. */
  const settledRef = useRef(false)
  useEffect(() => {
    if (settled && !settledRef.current && selectedBatchId) void refreshArtifacts(selectedBatchId)
    settledRef.current = settled
  }, [settled, selectedBatchId, refreshArtifacts])

  /* A run takes the page over only when it has something to show or something
     in flight.
     ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄
     `currentRunId` alone was enough, and it is persisted to localStorage. So a
     run id that outlived its messages — stopped server-side, or a record that
     never produced one — hid the form behind a run view whose own derived
     stage was `idle`. The result was a stepper on step 1, the words "Fill in
     the form and click Generate to start", and no form anywhere on the page.
     Nothing was wrong except that neither half believed it was in charge. */
  const started =
    (run.messages.length > 0 || Boolean(run.currentRunId)) && (stage !== 'idle' || run.sending)
  const missing = missingRequiredInputs(form, Boolean(selectedBatch))

  return (
    <div className="pb-8">
      <Toast toast={toast} onDismiss={() => setToast(null)} />

      <div className="mb-4">
        <h1 className="text-2xl font-bold text-slate-800 tracking-tight">Lesson Plans</h1>
        <p className="text-sm text-slate-500 mt-1">
          Generate a lesson plan from Course-Space files, web search, and any attachments.
        </p>
      </div>

      <PlanHintBanner batchId={selectedBatchId} />

      {started && selectedBatch ? (
        <div>
          {/* The floor is for the *working* stages, where thinking and a step
              list need somewhere to grow without the card resizing under them.
              Once there is a result it only leaves dead space: a short preview
              card and two buttons sat in 384px with a third of it empty. */}
          <div
            className={`flex flex-col rounded-xl border border-slate-200 bg-white shadow-sm ${
              settled ? '' : 'min-h-[24rem]'
            }`}
          >
              <GenerationRunView
              batch={selectedBatch}
              run={run}
              accent="primary"
              onDiscard={discardRun}
              onGenerateAnother={() => run.reset()}
            />
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          <form onSubmit={handleGenerate} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
            <SelectField
              label="Space (batch)"
              value={selectedBatchId ?? ''}
              onChange={setSelectedBatchId}
              options={batchOptions}
              disabled={batchesLoading}
              placeholder={batchesLoading ? 'Loading spaces…' : 'Select a space'}
            />

            {/* Filling a required field without saying so is the kind of help
                that reads as a bug the first time someone notices it. One line,
                and every value stays editable. */}
            {prefill?.source === 'course-plan' && (
              <p className="text-xs text-slate-500">
                Prefilled from your Course Plan for week {prefill.week} — topic and what students already know.
                Change anything that does not fit.
              </p>
            )}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <NumberField
                label="Week"
                min={1}
                required
                value={form.week}
                onChange={(week) => setForm((f) => ({ ...f, week }))}
              />
              <SelectField
                label="Duration (min)"
                value={String(form.duration)}
                onChange={(v) => setForm((f) => ({ ...f, duration: Number(v) }))}
                options={DURATION_OPTIONS}
              />
              <SelectField
                label="Level"
                value={form.grade}
                onChange={(v) => setForm((f) => ({ ...f, grade: v }))}
                options={GRADE_OPTIONS}
              />
              <SelectField
                label="Difficulty"
                value={form.difficulty}
                onChange={(v) => setForm((f) => ({ ...f, difficulty: v }))}
                options={DIFFICULTY_OPTIONS}
              />
              <SelectField
                label="Approach"
                value={form.approach}
                onChange={(v) => setForm((f) => ({ ...f, approach: v }))}
                options={APPROACH_OPTIONS}
              />
              <SelectField
                label="Plan type"
                value={form.planType}
                onChange={(v) => setForm((f) => ({ ...f, planType: v }))}
                options={PLAN_TYPE_OPTIONS}
              />
            </div>

            <div>
              <label className={FIELD_LABEL_CLASS}>Prior knowledge</label>
              <textarea rows={2} required value={form.priorKnowledge}
                onChange={(e) => setForm((f) => ({ ...f, priorKnowledge: e.target.value }))}
                placeholder="What students already know, e.g. basic spreadsheet concepts"
                className={TEXTAREA_CLASS} />
            </div>

            <div>
              <button
                type="button"
                onClick={() => setShowOptional((v) => !v)}
                className="inline-flex items-center gap-1.5 text-sm font-medium text-violet-700 hover:text-violet-800"
              >
                <ChevronDown className={`h-4 w-4 transition-transform ${showOptional ? 'rotate-180' : ''}`} />
                {showOptional ? 'Hide optional details' : 'Show optional details'}
              </button>
              <Collapse open={showOptional}>
                  <div className="mt-3 space-y-3 rounded-lg border border-slate-100 bg-slate-50/70 p-3">
                    <div>
                      <label className={FIELD_LABEL_CLASS}>Lesson plan name</label>
                      <input type="text" value={form.title}
                        onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                        placeholder="Leave blank — agent names it from the course plan or topic"
                        className={FIELD_CLASS} />
                    </div>
                    <div>
                      <label className={FIELD_LABEL_CLASS}>Topic</label>
                      <input type="text" value={form.topic}
                        onChange={(e) => setForm((f) => ({ ...f, topic: e.target.value }))}
                        placeholder="Leave blank to let the agent choose from the course plan"
                        className={FIELD_CLASS} />
                    </div>
                    <div>
                      <label className={FIELD_LABEL_CLASS}>Additional instructions</label>
                      <textarea rows={2} value={form.instructions}
                        onChange={(e) => setForm((f) => ({ ...f, instructions: e.target.value }))}
                        placeholder="Anything else the agent should consider…"
                        className={TEXTAREA_CLASS} />
                    </div>
                  </div>
              </Collapse>
            </div>

            {selectedBatch && <GenerationAttachments run={run} />}
            <p className="text-xs text-slate-400">
              Course-Space files for the selected space are always used.
            </p>

            <div>
              <button type="submit" disabled={run.sending || missing.length > 0}
                className="inline-flex w-full items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium rounded-md text-white bg-violet-600 hover:bg-violet-700 shadow-sm transition-colors disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none disabled:cursor-not-allowed">
                {run.sending ? <Spinner tone="inverse" size={16} /> : <Sparkles className="w-4 h-4" />}
                Generate outline
              </button>
              {missing.length > 0 && !run.sending && (
                <p className="mt-2 text-center text-xs text-slate-500">
                  Add {joinReadable(missing)} to continue.
                </p>
              )}
            </div>
          </form>
        </div>
      )}

      {/* Outside the form/run split, so it stays on screen for the whole
          generation. It used to be the `else` branch of `started`, which meant
          the moment a lecturer pressed Generate their existing work vanished
          and only came back when the run finished — the one time they might
          want to glance at last week's plan is while this week's is being
          written. */}
      <div className="mt-6 min-w-0">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-slate-700">Saved lesson plans</h2>
          {/* The bordered button from the Games page, not the violet text
              link this used to be. Two pages doing the same job with
              controls of different weight made the lighter one read as a
              secondary action, which it is not. The icon spins while the
              fetch is in flight, so the button says whether it worked. */}
          {selectedBatchId && (
            <button
              type="button"
              onClick={() => void refreshArtifacts(selectedBatchId)}
              disabled={listLoading}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${listLoading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          )}
        </div>
        {listLoading ? (
          <div className="flex items-center gap-2 text-sm text-slate-500 py-6">
            <Spinner size={16} /> Loading…
          </div>
        ) : visibleArtifacts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-center rounded-xl border border-slate-100 bg-white">
            <LessonPlanIcon className="w-8 h-8 text-slate-300 mb-2" />
            <p className="text-sm text-slate-500">No lesson plans yet for this space.</p>
          </div>
        ) : (
          /* Full-width rows, the shape the Games page already uses for the
             same job. A three-column grid of small cards made each saved
             plan a tile to scan across; these are a list to read down, the
             title gets the whole width, and the one action sits where the
             eye ends rather than under the text.

             No status pill. Every one of these is `confirmed` in practice
             — a draft never reaches this list — so the tag was a constant
             repeated on every row, and neither Assessments nor Games shows
             one. */
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {visibleArtifacts.map((a) => (
              <article key={a.id} className="rounded-xl border border-slate-100 bg-white p-4 shadow-sm">
                <div className="flex items-start gap-3 mb-2">
                  <div className="h-9 w-9 rounded-lg bg-violet-50 text-violet-600 flex items-center justify-center border border-violet-100">
                    <LessonPlanIcon className="w-4 h-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-semibold text-slate-900 truncate">{a.title || 'Lesson plan'}</h3>
                    <p className="text-xs text-slate-500 mt-0.5">Week {a.week ?? '—'} · v{a.version ?? 1}</p>
                  </div>
                </div>
                {/* No status pill. Everything reaching this list is confirmed,
                    so the tag was the same word repeated on every card — and
                    neither Assessments nor Games carried one. */}
                <p className="text-xs text-slate-400 mb-3">{timeAgo(a.updated_at ? new Date(a.updated_at) : null)}</p>
                <div className="mt-3 flex items-center gap-2">
                  {a.doc_url && (
                    <a href={a.doc_url} target="_blank" rel="noreferrer"
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-slate-300 text-slate-700 transition-colors hover:border-violet-300 hover:bg-violet-50 hover:text-violet-800">
                      <ExternalLink className="w-3.5 h-3.5" /> Open Google Doc
                    </a>
                  )}
                  {/* Same flow as everywhere else: ask once, then hold the
                      delete for the undo window. Pushed to the end of the row
                      so the destructive control is never the one under the
                      thumb on the way to opening the document. */}
                  <button
                    type="button"
                    onClick={() => void handleDeleteArtifact(a)}
                    // slate-400 measures 2.63:1 on white — under the 3:1 floor
                    // for a graphical control; slate-500 clears it at 4.76:1.
                    className="ml-auto flex-shrink-0 rounded-md p-2 text-slate-500 transition-colors hover:bg-red-50 hover:text-red-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
                    aria-label={`Delete ${a.title || 'lesson plan'}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
