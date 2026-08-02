import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { ChevronDown, ExternalLink, Plus, RefreshCw, Sparkles, Trash2 } from 'lucide-react'
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
import { listArtifacts, type Artifact } from '../services/artifactService'
import { timeAgo } from '../utils/formatDate'
import { artifactIcon } from '../utils/artifactIcons'
import { SelectField, toOptions } from '../components/ui/SelectField'
import { NumberField } from '../components/ui/NumberField'
import { CHECKBOX_CLASS, FIELD_CLASS, FIELD_LABEL_CLASS, TEXTAREA_CLASS } from '../components/ui/fieldStyles'
import { Button, Spinner } from '../design-system'

const AssessmentIcon = artifactIcon('assessment')

const QUIZ_MODES: Array<{ value: string; label: string }> = [
  { value: 'mixed', label: 'Mixed' },
  { value: 'mcq_only', label: 'MCQ only' },
  { value: 'short_answer_only', label: 'Short answer only' },
]
const DIFFICULTIES = ['easy', 'medium', 'hard']

// Labels are display-only; the values below go into the agent prompt verbatim.
const DIFFICULTY_OPTIONS = toOptions(DIFFICULTIES, (d) => d[0].toUpperCase() + d.slice(1))

const INITIAL_FORM = {
  title: '',
  topic: '',
  week: 1,
  totalQuestions: 10,
  quizMode: 'mixed',
  difficulty: 'medium',
  hasTimeLimit: false,
  timeLimit: 30,
  instructions: '',
}

function buildMessage(f: typeof INITIAL_FORM): string {
  const lines = [
    `Generate a quiz/assessment for week ${f.week}.`,
    'Standalone form submission: all required fields below are confirmed. Do not ask clarifying questions; proceed with the assessment workflow.',
  ]
  if (f.title.trim()) lines.push(`Preferred assessment title: ${f.title.trim()}`)
  else {
    lines.push(
      'Preferred assessment title: not specified — auto-name the quiz. If an active Course Plan exists, derive the title from that week\'s theme/assessment idea; otherwise name it from the topic and course.',
    )
  }
  if (f.topic.trim()) lines.push(`Topic: ${f.topic.trim()}`)
  else {
    lines.push(
      'Topic: not specified — choose a suitable topic for this week from the active Course Plan week guidance if available; otherwise pick a suitable topic for the course.',
    )
  }
  lines.push(
    `Number of questions: ${f.totalQuestions}`,
    `Question mode: ${f.quizMode}`,
    `Difficulty: ${f.difficulty}`,
  )
  lines.push(f.hasTimeLimit ? `Time limit: ${f.timeLimit} minutes` : 'Time limit: none (no strict time limit).')
  if (f.instructions.trim()) lines.push(`Additional instructions: ${f.instructions.trim()}`)
  lines.push(
    'If course_blueprint_status is active, you MUST reference the Course Plan (especially course_blueprint_week_plan and assessment strategy) when choosing topic/title and aligning questions.',
    'If no lesson plan artifact exists for this week, proceed with Course Plan + course materials without asking for confirmation.',
  )
  return lines.join('\n')
}

function missingRequiredInputs(f: typeof INITIAL_FORM, hasBatch: boolean): string[] {
  const missing: string[] = []
  if (!hasBatch) missing.push('a space')
  if (!(Number(f.week) >= 1)) missing.push('a week number')
  if (!(Number(f.totalQuestions) >= 1)) missing.push('a question count')
  if (f.hasTimeLimit && !(Number(f.timeLimit) >= 1)) missing.push('a time limit')
  return missing
}

function joinReadable(items: string[]): string {
  if (items.length <= 1) return items[0] ?? ''
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

export default function Assessments() {
  const { batches, loading: batchesLoading, selectedBatch, selectedBatchId, setSelectedBatchId } =
    useBatchSelection()
  const run = useGenerationRun(selectedBatch, 'assessment')

  const [form, setForm] = useState(INITIAL_FORM)
  const [toast, setToast] = useState<ToastMessage | null>(null)
  const [artifacts, setArtifacts] = useState<Artifact[]>([])
  // Starts true: nothing has been fetched yet, and `false` here reads as
  // "loaded, and there is nothing" — which is what raced the prefill.
  const [listLoading, setListLoading] = useState(true)
  const prefill = useWorkflowPrefill(selectedBatchId, listLoading ? null : artifacts)
  // Once per space — see LessonPlans. An assessment has no prior-knowledge
  // field, so only the week and the topic come across.
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
    }))
  }, [prefill, selectedBatchId])
  const [showOptional, setShowOptional] = useState(false)

  const showToast = useCallback((type: ToastMessage['type'], message: string) => {
    setToast({ type, message })
    window.setTimeout(() => setToast(null), 5000)
  }, [])

  const refreshArtifacts = useCallback(async (batchId: string) => {
    setListLoading(true)
    try {
      const data = await listArtifacts(batchId, { type: 'quiz', current: true })
      setArtifacts(data)
    } catch (err) {
      console.error(err)
      showToast('error', getErrorMessage(err, 'Could not load assessments.'))
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
      workflowType: 'assessment',
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
  const discardRun = useCallback(() => {
    if (
      !window.confirm(
        'Discard this draft?\n\nNothing has been saved, and you will start again from the form.',
      )
    ) {
      return
    }
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
        <h1 className="text-2xl font-bold text-slate-800 tracking-tight">Assessments</h1>
        <p className="text-sm text-slate-500 mt-1">
          Generate a quiz from Course-Space files and attachments, then export to Google Forms.
        </p>
      </div>

      <PlanHintBanner batchId={selectedBatchId} />

      {started && selectedBatch ? (
        <div>
          {/* No heading: the page title above already names the workflow, and
              repeating it in smaller type says nothing the reader did not just
              read. The row exists only to hang the reset control off. */}
          <div className="mb-3 flex items-center justify-end">
            {/* Only once the workflow has finished. It used to appear the moment
                a run started, so a tap mid-generation — or mid-approval —
                discarded work in progress with no warning and no undo. */}
            {/* Always one way out.
                Restricting this to `settled` meant every unfinished state —
                waiting on an approval, mid-generation, or the empty one above
                — had no exit at all, and the workflow is persisted, so a page
                the lecturer could not leave came back on every reload. */}
            {settled ? (
              <Button type="button" variant="secondary" size="sm" onClick={() => run.reset()}
                leadingIcon={<Plus className="h-4 w-4" />}>
                Generate another
              </Button>
            ) : (
              <Button type="button" variant="secondary" size="sm" onClick={discardRun}
                leadingIcon={<Trash2 className="h-4 w-4" />}>
                Discard
              </Button>
            )}
          </div>
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
                Prefilled from your Course Plan for week {prefill.week} — topic.
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
              <NumberField
                label="# Questions"
                min={1}
                max={50}
                required
                value={form.totalQuestions}
                onChange={(totalQuestions) => setForm((f) => ({ ...f, totalQuestions }))}
              />
              <SelectField
                label="Mode"
                value={form.quizMode}
                onChange={(v) => setForm((f) => ({ ...f, quizMode: v }))}
                options={QUIZ_MODES}
              />
              <SelectField
                label="Difficulty"
                value={form.difficulty}
                onChange={(v) => setForm((f) => ({ ...f, difficulty: v }))}
                options={DIFFICULTY_OPTIONS}
              />
              <div className="col-span-2">
                <label className="mb-1 inline-flex items-center gap-2 text-sm font-semibold text-slate-700">
                  <input type="checkbox" checked={form.hasTimeLimit}
                    onChange={(e) => setForm((f) => ({ ...f, hasTimeLimit: e.target.checked }))}
                    className={CHECKBOX_CLASS} />
                  Set a time limit
                </label>
                {form.hasTimeLimit && (
                  <div className="mt-1 flex items-center gap-2">
                    <NumberField
                      className="w-28"
                      aria-label="Time limit in minutes"
                      min={1}
                      required
                      value={form.timeLimit}
                      onChange={(timeLimit) => setForm((f) => ({ ...f, timeLimit }))}
                    />
                    <span className="text-sm text-slate-500">minutes</span>
                  </div>
                )}
              </div>
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
              {showOptional && (
                <div className="mt-3 space-y-3 rounded-lg border border-slate-100 bg-slate-50/70 p-3">
                  <div>
                    <label className={FIELD_LABEL_CLASS}>Assessment name</label>
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
              )}
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
      <div className="mt-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-slate-700">Saved assessments</h2>
          {/* Matches the Games page and Lesson Plans — see the comment
              there. The icon spins while the fetch is in flight. */}
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
        ) : artifacts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-center rounded-xl border border-slate-100 bg-white">
            <AssessmentIcon className="w-8 h-8 text-slate-300 mb-2" />
            <p className="text-sm text-slate-500">No assessments yet for this space.</p>
          </div>
        ) : (
          /* The same row as Lesson Plans and Games — see the note there. */
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {artifacts.map((a) => (
              <article key={a.id} className="rounded-xl border border-slate-100 bg-white p-4 shadow-sm">
                <div className="flex items-start gap-3 mb-2">
                  <div className="h-9 w-9 rounded-lg bg-violet-50 text-violet-600 flex items-center justify-center border border-violet-100">
                    <AssessmentIcon className="w-4 h-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-semibold text-slate-900 truncate">{a.title || 'Quiz'}</h3>
                    <p className="text-xs text-slate-500 mt-0.5">Week {a.week ?? '—'} · v{a.version ?? 1}</p>
                  </div>
                </div>
                {/* No status pill. Everything reaching this list is confirmed,
                    so the tag was the same word repeated on every card — and
                    neither Assessments nor Games carried one. */}
                <p className="text-xs text-slate-400 mb-3">{timeAgo(a.updated_at ? new Date(a.updated_at) : null)}</p>
                {a.form_url && (
                  <a href={a.form_url} target="_blank" rel="noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-slate-300 text-slate-700 transition-colors hover:border-violet-300 hover:bg-violet-50 hover:text-violet-800">
                    <ExternalLink className="w-3.5 h-3.5" /> Open Google Form
                  </a>
                )}
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
