import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Loader2, Pencil, Save, X } from 'lucide-react'
import type { ChatMessage } from '../../../entity/Chat'
import {
  saveCourseBlueprintFromMessage,
  type CourseBlueprint,
  type CourseBlueprintRecommendation,
  type CourseBlueprintWeeklyPlanItem,
} from '../../../services/courseBlueprintService'
import { MarkdownBlock } from './MessageRow'
import { normalizeApiErrorMessage } from './CourseBlueprintReviewModal'

export function SuggestedCourseBlueprintModal({
  batchId,
  message,
  recommendation,
  onClose,
  onEdit,
  onSaved,
}: {
  batchId: string
  message: ChatMessage
  recommendation: CourseBlueprintRecommendation
  onClose: () => void
  onEdit: () => void
  onSaved: (blueprint: CourseBlueprint) => void
}) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previous }
  }, [])

  async function saveRecommendation() {
    setSaving(true)
    setError('')
    try {
      const saved = await saveCourseBlueprintFromMessage(
        batchId,
        buildSuggestedBlueprintSavePayload(message, recommendation),
      )
      onSaved(saved)
    } catch (err) {
      setError(normalizeApiErrorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-slate-950/50 p-3 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Review Recommended Course Blueprint">
      <div className="flex max-h-[94vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <header className="flex items-start justify-between border-b border-slate-200 px-5 py-4">
          <div><h2 className="text-lg font-semibold text-slate-900">Review Recommended Course Blueprint</h2><p className="text-sm text-slate-500">The consultant proposed this structured plan. Nothing is saved until you confirm.</p></div>
          <button onClick={onClose} disabled={saving} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="Close"><X className="h-5 w-5" /></button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <p className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs leading-5 text-emerald-800">Generated weeks are included as prior context where available. Proposed weeks are marked as suggested.</p>
          <RecommendationView recommendation={recommendation} />
          <details className="mt-6 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3"><summary className="cursor-pointer text-sm font-medium text-slate-700">View consultant response</summary><div className="mt-3 rounded-lg bg-white p-4 text-sm"><MarkdownBlock content={message.content} /></div></details>
          {error && <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        </div>
        <footer className="flex flex-wrap justify-end gap-3 border-t p-4">
          <button onClick={onClose} disabled={saving} className="rounded-lg border px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50">Cancel</button>
          <button onClick={onEdit} disabled={saving} className="inline-flex items-center gap-2 rounded-lg border border-emerald-200 px-4 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"><Pencil className="h-4 w-4" />Edit before saving</button>
          <button onClick={() => void saveRecommendation()} disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Save recommendation</button>
        </footer>
      </div>
    </div>,
    document.body,
  )
}

export function buildSuggestedBlueprintSavePayload(
  message: ChatMessage,
  recommendation: CourseBlueprintRecommendation,
) {
  return {
    ...recommendation,
    source_chat_id: message.chat_id,
    source_message_id: message.message_id,
    source_run_id: message.run_id || '',
  }
}

export function RecommendationView({ recommendation }: { recommendation: CourseBlueprintRecommendation }) {
  return <div className="space-y-5 text-sm text-slate-700">
    <div><div className="flex flex-wrap items-center gap-2"><h3 className="text-xl font-semibold text-slate-900">{recommendation.title}</h3><span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{recommendation.plan_scope.replaceAll('_', ' ')}</span>{recommendation.planning_horizon_weeks && <span className="text-xs text-slate-500">{recommendation.planning_horizon_weeks} weeks</span>}</div>{recommendation.summary && <p className="mt-2 whitespace-pre-wrap">{recommendation.summary}</p>}</div>
    {recommendation.weekly_plan.length > 0 && <section><h4 className="mb-2 font-semibold text-slate-800">Weekly plan</h4><div className="space-y-2">{recommendation.weekly_plan.map((week) => <WeekPreview key={week.week} item={week} />)}</div></section>}
    {recommendation.assessment_strategy && <Section title="Assessment strategy">{recommendation.assessment_strategy}</Section>}
    {recommendation.lab_strategy && <Section title="Lab strategy">{recommendation.lab_strategy}</Section>}
    {Object.keys(recommendation.teaching_preferences).length > 0 && <section><h4 className="mb-1 font-semibold text-slate-800">Teaching preferences</h4><dl>{Object.entries(recommendation.teaching_preferences).map(([key, value]) => <div key={key} className="flex gap-2"><dt className="font-medium">{key}:</dt><dd>{value}</dd></div>)}</dl></section>}
    {recommendation.open_questions.length > 0 && <ListSection title="Open questions" items={recommendation.open_questions} />}
    {(recommendation.assumptions || []).length > 0 && <ListSection title="Assumptions" items={recommendation.assumptions || []} />}
    {recommendation.source_summary && <Section title="Source summary">{recommendation.source_summary}</Section>}
  </div>
}

function WeekPreview({ item }: { item: CourseBlueprintWeeklyPlanItem }) {
  return <article className="rounded-xl border border-slate-200 p-3"><div className="flex flex-wrap items-center gap-2"><span className="font-semibold text-slate-900">Week {item.week}: {item.theme}</span>{item.source_status && <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${item.source_status === 'proposed' ? 'bg-blue-50 text-blue-700' : 'bg-emerald-50 text-emerald-700'}`}>{sourceStatusLabel(item.source_status)}</span>}</div><div className="mt-2 grid gap-1 text-xs text-slate-600 sm:grid-cols-2">{item.lesson_goal && <p><strong>Lesson:</strong> {item.lesson_goal}</p>}{item.lab_goal && <p><strong>Lab:</strong> {item.lab_goal}</p>}{item.assessment_idea && <p><strong>Assessment:</strong> {item.assessment_idea}</p>}{item.notes && <p><strong>Notes:</strong> {item.notes}</p>}</div>{item.source_refs && item.source_refs.length > 0 && <p className="mt-2 text-[11px] text-slate-400">Sources: {item.source_refs.join(', ')}</p>}</article>
}

function sourceStatusLabel(status: NonNullable<CourseBlueprintWeeklyPlanItem['source_status']>) {
  return ({ generated_artifact: 'From generated artifact', saved_blueprint: 'From saved blueprint', user_provided: 'From your instruction', proposed: 'Proposed', unknown: 'Source unknown' } as const)[status]
}
function Section({ title, children }: { title: string; children: string }) { return <section><h4 className="mb-1 font-semibold text-slate-800">{title}</h4><p className="whitespace-pre-wrap">{children}</p></section> }
function ListSection({ title, items }: { title: string; items: string[] }) { return <section><h4 className="mb-1 font-semibold text-slate-800">{title}</h4><ul className="list-disc pl-5">{items.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul></section> }
