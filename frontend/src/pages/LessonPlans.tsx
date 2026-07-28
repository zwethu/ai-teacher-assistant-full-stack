import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { BookOpen, Clock, ExternalLink, FileText, Loader2, Plus, Sparkles } from 'lucide-react'
import type { ToastMessage } from '../types'
import Toast from '../components/ui/Toast'
import { getErrorMessage } from '../utils/errors'
import { useBatchSelection } from '../hooks/useBatchSelection'
import { useGenerationRun } from '../hooks/useGenerationRun'
import { GenerationRunView } from '../components/generation/GenerationRunView'
import { GenerationAttachments } from '../components/generation/GenerationAttachments'
import { PlanHintBanner } from '../components/generation/PlanHintBanner'
import { listArtifacts, type Artifact } from '../services/artifactService'
import { timeAgo } from '../utils/formatDate'

const GRADES = ['Undergraduate Y1', 'Undergraduate Y2', 'Undergraduate Y3', 'Undergraduate Y4', 'Postgraduate']
const DURATIONS = [30, 45, 60, 90, 120, 180]
const DIFFICULTIES = ['easy', 'medium', 'hard']
const APPROACHES = ['inquiry-based', 'direct', 'project-based', 'mixed']
const PLAN_TYPES = [
  'standard', 'scenario_based', 'case_based', 'lab_based',
  'project_based', 'flipped', 'workshop_practice', 'review_remediation',
]

const INITIAL_FORM = {
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
  const lines = [`Generate a lesson plan for week ${f.week}.`]
  if (f.topic.trim()) lines.push(`Topic: ${f.topic.trim()}`)
  else lines.push('Topic: not specified — choose a suitable topic for this week, using the course plan if one exists.')
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
  const [listLoading, setListLoading] = useState(false)

  const showToast = useCallback((type: ToastMessage['type'], message: string) => {
    setToast({ type, message })
    window.setTimeout(() => setToast(null), 5000)
  }, [])

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
    if (selectedBatchId) void refreshArtifacts(selectedBatchId)
    else setArtifacts([])
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
  const started = run.messages.length > 0 || Boolean(run.currentRunId)
  const missing = missingRequiredInputs(form, Boolean(selectedBatch))

  return (
    <div>
      <Toast toast={toast} onDismiss={() => setToast(null)} />

      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800 tracking-tight">Lesson Plans</h1>
        <p className="text-sm text-slate-500 mt-1">
          Generate a lesson plan for a space. The agent uses the space's Course-Space files,
          web search, and any files you attach.
        </p>
      </div>

      <PlanHintBanner batchId={selectedBatchId} />

      {started && selectedBatch ? (
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-700">Lesson plan generation</h2>
            <button type="button" onClick={() => run.reset()}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
              <Plus className="h-4 w-4" /> Generate another
            </button>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm min-h-[24rem] max-h-[80vh] overflow-y-auto">
            <GenerationRunView batch={selectedBatch} run={run} accent="emerald" />
          </div>
        </div>
      ) : (
        <form onSubmit={handleGenerate} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Space (batch)</label>
            <select
              required
              value={selectedBatchId ?? ''}
              onChange={(e) => setSelectedBatchId(e.target.value)}
              disabled={batchesLoading}
              className="block w-full rounded-md border border-slate-300 py-2.5 px-2 text-sm focus:border-emerald-500 focus:ring-emerald-500"
            >
              {batches.map((b) => (
                <option key={b.id} value={b.id}>{b.batch_name} — {b.course_name}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1.5">Week</label>
              <input type="number" min={1} required value={form.week}
                onChange={(e) => setForm((f) => ({ ...f, week: Number(e.target.value || 1) }))}
                className="block w-full rounded-md border border-slate-300 py-2.5 px-3 text-sm focus:border-emerald-500 focus:ring-emerald-500" />
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1.5">Duration (min)</label>
              <select value={form.duration} onChange={(e) => setForm((f) => ({ ...f, duration: Number(e.target.value) }))}
                className="block w-full rounded-md border border-slate-300 py-2.5 px-2 text-sm focus:border-emerald-500 focus:ring-emerald-500">
                {DURATIONS.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Topic (optional)</label>
            <input type="text" value={form.topic}
              onChange={(e) => setForm((f) => ({ ...f, topic: e.target.value }))}
              placeholder="Leave blank to let the agent choose from the course plan"
              className="block w-full rounded-md border border-slate-300 py-2.5 px-3 text-sm focus:border-emerald-500 focus:ring-emerald-500" />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1.5">Level</label>
              <select value={form.grade} onChange={(e) => setForm((f) => ({ ...f, grade: e.target.value }))}
                className="block w-full rounded-md border border-slate-300 py-2.5 px-2 text-sm focus:border-emerald-500 focus:ring-emerald-500">
                {GRADES.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1.5">Difficulty</label>
              <select value={form.difficulty} onChange={(e) => setForm((f) => ({ ...f, difficulty: e.target.value }))}
                className="block w-full rounded-md border border-slate-300 py-2.5 px-2 text-sm focus:border-emerald-500 focus:ring-emerald-500 capitalize">
                {DIFFICULTIES.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1.5">Approach</label>
              <select value={form.approach} onChange={(e) => setForm((f) => ({ ...f, approach: e.target.value }))}
                className="block w-full rounded-md border border-slate-300 py-2.5 px-2 text-sm focus:border-emerald-500 focus:ring-emerald-500">
                {APPROACHES.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1.5">Plan type</label>
              <select value={form.planType} onChange={(e) => setForm((f) => ({ ...f, planType: e.target.value }))}
                className="block w-full rounded-md border border-slate-300 py-2.5 px-2 text-sm focus:border-emerald-500 focus:ring-emerald-500">
                {PLAN_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Prior knowledge</label>
            <textarea rows={2} required value={form.priorKnowledge}
              onChange={(e) => setForm((f) => ({ ...f, priorKnowledge: e.target.value }))}
              placeholder="What students already know before this lesson, e.g. basic spreadsheet and database concepts"
              className="block w-full rounded-md border border-slate-300 py-2.5 px-3 text-sm focus:border-emerald-500 focus:ring-emerald-500 resize-y" />
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Additional instructions (optional)</label>
            <textarea rows={2} value={form.instructions}
              onChange={(e) => setForm((f) => ({ ...f, instructions: e.target.value }))}
              placeholder="Anything else the agent should consider…"
              className="block w-full rounded-md border border-slate-300 py-2.5 px-3 text-sm focus:border-emerald-500 focus:ring-emerald-500 resize-y" />
          </div>

          {selectedBatch && <GenerationAttachments run={run} />}
          <p className="text-xs text-slate-400">
            Course-Space files for the selected space are always used.
          </p>

          <div>
            <button type="submit" disabled={run.sending || missing.length > 0}
              className="inline-flex w-full items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium rounded-md text-white bg-emerald-600 hover:bg-emerald-700 shadow-sm transition-colors disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none disabled:cursor-not-allowed">
              {run.sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              Generate outline
            </button>
            {missing.length > 0 && !run.sending && (
              <p className="mt-2 text-center text-xs text-slate-500">
                Add {joinReadable(missing)} to continue.
              </p>
            )}
          </div>
        </form>
      )}

      {/* Existing lesson plans (canonical artifacts) */}
      <div className="mt-8">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-slate-700">Saved lesson plans</h2>
          {selectedBatchId && (
            <button type="button" onClick={() => void refreshArtifacts(selectedBatchId)}
              className="text-xs text-emerald-700 hover:underline">Refresh</button>
          )}
        </div>
        {listLoading ? (
          <div className="flex items-center gap-2 text-sm text-slate-500 py-6">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading…
          </div>
        ) : artifacts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-center rounded-xl border border-slate-100 bg-white">
            <FileText className="w-8 h-8 text-slate-300 mb-2" />
            <p className="text-sm text-slate-500">No lesson plans yet for this space.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {artifacts.map((a) => (
              <article key={a.id} className="rounded-xl border border-slate-100 bg-white p-4 shadow-sm">
                <div className="flex items-start gap-3 mb-2">
                  <div className="h-9 w-9 rounded-lg bg-sky-50 text-sky-600 flex items-center justify-center border border-sky-100">
                    <BookOpen className="w-4 h-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-semibold text-slate-900 truncate">{a.title || 'Lesson plan'}</h3>
                    <p className="text-xs text-slate-500 mt-0.5">Week {a.week ?? '—'} · v{a.version ?? 1}</p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 mb-3">
                  {a.status && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-slate-100 text-slate-600 border border-slate-200">
                      <Clock className="w-3 h-3" />{a.status}
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-400 mb-3">{timeAgo(a.updated_at ? new Date(a.updated_at) : null)}</p>
                {a.doc_url && (
                  <a href={a.doc_url} target="_blank" rel="noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-slate-300 text-slate-700 hover:bg-slate-50">
                    <ExternalLink className="w-3.5 h-3.5" /> Open Google Doc
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
