import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { ChevronDown, ExternalLink, Plus, Sparkles } from 'lucide-react'
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
import { Button, Spinner } from '../design-system'

const AssessmentIcon = artifactIcon('assessment')

const QUIZ_MODES: Array<{ value: string; label: string }> = [
  { value: 'mixed', label: 'Mixed' },
  { value: 'mcq_only', label: 'MCQ only' },
  { value: 'short_answer_only', label: 'Short answer only' },
]
const DIFFICULTIES = ['easy', 'medium', 'hard']

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
  const started = run.messages.length > 0 || Boolean(run.currentRunId)
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
            {isWorkflowSettled(deriveGenerationStage(run).stage) && (
              <Button type="button" variant="secondary" size="sm" onClick={() => run.reset()}
                leadingIcon={<Plus className="h-4 w-4" />}>
                Generate another
              </Button>
            )}
          </div>
          {/* The floor is for the *working* stages, where thinking and a step
              list need somewhere to grow without the card resizing under them.
              Once there is a result it only leaves dead space: a short preview
              card and two buttons sat in 384px with a third of it empty. */}
          <div
            className={`flex flex-col rounded-xl border border-slate-200 bg-white shadow-sm ${
              isWorkflowSettled(deriveGenerationStage(run).stage) ? '' : 'min-h-[24rem]'
            }`}
          >
            <GenerationRunView batch={selectedBatch} run={run} accent="primary" />
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          <form onSubmit={handleGenerate} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">Space (batch)</label>
              <select required value={selectedBatchId ?? ''} onChange={(e) => setSelectedBatchId(e.target.value)}
                disabled={batchesLoading}
                className="block w-full rounded-md border border-slate-300 py-2 px-2 text-sm focus:border-violet-500 focus:ring-violet-500">
                {batches.map((b) => <option key={b.id} value={b.id}>{b.batch_name} — {b.course_name}</option>)}
              </select>
            </div>

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
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">Week</label>
                <input type="number" min={1} required value={form.week}
                  onChange={(e) => setForm((f) => ({ ...f, week: Number(e.target.value || 1) }))}
                  className="block w-full rounded-md border border-slate-300 py-2 px-2.5 text-sm focus:border-violet-500 focus:ring-violet-500" />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1"># Questions</label>
                <input type="number" min={1} max={50} required value={form.totalQuestions}
                  onChange={(e) => setForm((f) => ({ ...f, totalQuestions: Number(e.target.value || 1) }))}
                  className="block w-full rounded-md border border-slate-300 py-2 px-2.5 text-sm focus:border-violet-500 focus:ring-violet-500" />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">Mode</label>
                <select value={form.quizMode} onChange={(e) => setForm((f) => ({ ...f, quizMode: e.target.value }))}
                  className="block w-full rounded-md border border-slate-300 py-2 px-2 text-sm focus:border-violet-500 focus:ring-violet-500">
                  {QUIZ_MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">Difficulty</label>
                <select value={form.difficulty} onChange={(e) => setForm((f) => ({ ...f, difficulty: e.target.value }))}
                  className="block w-full rounded-md border border-slate-300 py-2 px-2 text-sm focus:border-violet-500 focus:ring-violet-500 capitalize">
                  {DIFFICULTIES.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <div className="col-span-2">
                <label className="mb-1 inline-flex items-center gap-2 text-sm font-semibold text-slate-700">
                  <input type="checkbox" checked={form.hasTimeLimit}
                    onChange={(e) => setForm((f) => ({ ...f, hasTimeLimit: e.target.checked }))}
                    className="accent-violet-600" />
                  Set a time limit
                </label>
                {form.hasTimeLimit && (
                  <div className="mt-1 flex items-center gap-2">
                    <input type="number" min={1} required value={form.timeLimit}
                      onChange={(e) => setForm((f) => ({ ...f, timeLimit: Number(e.target.value || 1) }))}
                      className="w-28 rounded-md border border-slate-300 py-2 px-2.5 text-sm focus:border-violet-500 focus:ring-violet-500" />
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
                    <label className="block text-sm font-semibold text-slate-700 mb-1">Assessment name</label>
                    <input type="text" value={form.title}
                      onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                      placeholder="Leave blank — agent names it from the course plan or topic"
                      className="block w-full rounded-md border border-slate-300 py-2 px-2.5 text-sm focus:border-violet-500 focus:ring-violet-500" />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-1">Topic</label>
                    <input type="text" value={form.topic}
                      onChange={(e) => setForm((f) => ({ ...f, topic: e.target.value }))}
                      placeholder="Leave blank to let the agent choose from the course plan"
                      className="block w-full rounded-md border border-slate-300 py-2 px-2.5 text-sm focus:border-violet-500 focus:ring-violet-500" />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-1">Additional instructions</label>
                    <textarea rows={2} value={form.instructions}
                      onChange={(e) => setForm((f) => ({ ...f, instructions: e.target.value }))}
                      placeholder="Anything else the agent should consider…"
                      className="block w-full rounded-md border border-slate-300 py-2 px-2.5 text-sm focus:border-violet-500 focus:ring-violet-500 resize-y" />
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

          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-slate-700">Saved assessments</h2>
              {selectedBatchId && (
                <button type="button" onClick={() => void refreshArtifacts(selectedBatchId)}
                  className="text-xs text-violet-700 hover:underline">Refresh</button>
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
                    <p className="text-xs text-slate-400 mb-3">{timeAgo(a.updated_at ? new Date(a.updated_at) : null)}</p>
                    {a.form_url && (
                      <a href={a.form_url} target="_blank" rel="noreferrer"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-slate-300 text-slate-700 hover:bg-slate-50">
                        <ExternalLink className="w-3.5 h-3.5" /> Open Google Form
                      </a>
                    )}
                  </article>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
