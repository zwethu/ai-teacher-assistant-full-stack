import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { BookOpen, Clock, ExternalLink, FileText, Loader2, Sparkles } from 'lucide-react'
import type { ToastMessage } from '../types'
import Toast from '../components/ui/Toast'
import { getErrorMessage } from '../utils/errors'
import { useBatchSelection } from '../hooks/useBatchSelection'
import { useGenerationRun } from '../hooks/useGenerationRun'
import { GenerationWorkspace } from '../components/generation/GenerationWorkspace'
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
  const lines = [
    `Generate a lesson plan for week ${f.week}.`,
    `Topic: ${f.topic}`,
    `Grade/level: ${f.grade}`,
    `Duration: ${f.duration} minutes`,
    `Difficulty: ${f.difficulty}`,
    `Teaching approach: ${f.approach}`,
    `Lesson plan type: ${f.planType}`,
  ]
  if (f.priorKnowledge.trim()) lines.push(`Prior knowledge: ${f.priorKnowledge.trim()}`)
  if (f.instructions.trim()) lines.push(`Additional instructions: ${f.instructions.trim()}`)
  return lines.join('\n')
}

export default function LessonPlans() {
  const { batches, loading: batchesLoading, selectedBatch, selectedBatchId, setSelectedBatchId } =
    useBatchSelection()
  const run = useGenerationRun(selectedBatch)

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
    if (!form.topic.trim()) {
      showToast('error', 'Please enter a topic.')
      return
    }
    await run.generate({
      workflowType: 'lesson_plan',
      message: buildMessage(form),
      week: Number(form.week) || 1,
      webSearch: true,
    })
  }

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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: form */}
        <form onSubmit={handleGenerate} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-4 self-start">
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
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Topic</label>
            <input type="text" required value={form.topic}
              onChange={(e) => setForm((f) => ({ ...f, topic: e.target.value }))}
              placeholder="e.g. Introduction to Neural Networks"
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
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Prior knowledge (optional)</label>
            <textarea rows={2} value={form.priorKnowledge}
              onChange={(e) => setForm((f) => ({ ...f, priorKnowledge: e.target.value }))}
              className="block w-full rounded-md border border-slate-300 py-2.5 px-3 text-sm focus:border-emerald-500 focus:ring-emerald-500 resize-y" />
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Additional instructions (optional)</label>
            <textarea rows={2} value={form.instructions}
              onChange={(e) => setForm((f) => ({ ...f, instructions: e.target.value }))}
              placeholder="Anything else the agent should consider…"
              className="block w-full rounded-md border border-slate-300 py-2.5 px-3 text-sm focus:border-emerald-500 focus:ring-emerald-500 resize-y" />
          </div>

          <p className="text-xs text-slate-400">
            Optional files can be attached in the workspace after you start. Course-Space files for the
            selected space are always used.
          </p>

          <button type="submit" disabled={run.sending || !selectedBatch}
            className="inline-flex w-full items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium rounded-md text-white bg-emerald-600 hover:bg-emerald-700 shadow-sm disabled:opacity-60">
            {run.sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            Generate outline
          </button>
        </form>

        {/* Right: workspace */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm min-h-[24rem] max-h-[80vh]">
          {selectedBatch ? (
            <GenerationWorkspace
              batch={selectedBatch}
              run={run}
              emptyHint="Fill in the form and click Generate. The agent will draft an outline for your approval, then the full plan."
            />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-slate-400">
              Select a space to begin.
            </div>
          )}
        </div>
      </div>

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
