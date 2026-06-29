import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ClipboardCopy, Loader2, Plus, Trash2, X } from 'lucide-react'
import type { ChatMessage } from '../../../entity/Chat'
import {
  saveCourseBlueprintFromMessage,
  type CourseBlueprint,
  type CourseBlueprintContent,
  type CourseBlueprintWeeklyPlanItem,
} from '../../../services/courseBlueprintService'
import { MarkdownBlock } from './MessageRow'

// ---------------------------------------------------------------------------
// API error normalisation
// ---------------------------------------------------------------------------

/**
 * Convert any axios/fetch error to a plain readable string.
 *
 * FastAPI returns 422 detail as an array of validation objects:
 *   [{ loc: [...], msg: "...", type: "..." }, ...]
 *
 * We must never set React state to an object or array.
 */
export function normalizeApiErrorMessage(err: unknown): string {
  if (!err || typeof err !== 'object') return 'An unexpected error occurred.'

  // Try axios-style response envelope
  const response = (err as { response?: { data?: { detail?: unknown } } }).response
  const detail = response?.data?.detail

  if (typeof detail === 'string') return detail

  // FastAPI 422: detail is an array of validation objects
  if (Array.isArray(detail)) {
    const messages = detail
      .map((item) => {
        if (typeof item === 'string') return item
        if (item && typeof item === 'object') {
          const msg = (item as Record<string, unknown>).msg
          return typeof msg === 'string' ? msg : JSON.stringify(item)
        }
        return String(item)
      })
      .filter(Boolean)
    return messages.length > 0
      ? messages.join('; ')
      : 'Validation error. Check all required fields.'
  }

  if (detail && typeof detail === 'object') {
    return JSON.stringify(detail).slice(0, 300)
  }

  // Fallback to message property
  const message = (err as { message?: unknown }).message
  if (typeof message === 'string' && message) return message

  return 'Could not save the Course Blueprint.'
}

// ---------------------------------------------------------------------------
// Substantive content guard
// ---------------------------------------------------------------------------

/**
 * Returns true when the form has enough content to be worth saving.
 * Title alone is not enough — there must be at least one substantive field.
 */
export function hasSubstantiveBlueprintContent(
  form: CourseBlueprintContent,
  preferences: Array<{ key: string; value: string }>,
): boolean {
  if (form.summary.trim()) return true
  if (form.assessment_strategy.trim()) return true
  if (form.lab_strategy.trim()) return true
  if (
    form.weekly_plan.some(
      (item) =>
        item.theme.trim() ||
        item.lesson_goal?.trim() ||
        item.lab_goal?.trim() ||
        item.assessment_idea?.trim() ||
        item.notes?.trim(),
    )
  )
    return true
  if (preferences.some((p) => p.key.trim() && p.value.trim())) return true
  if (form.open_questions.some((q) => q.trim())) return true
  return false
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type Props = {
  batchId: string
  courseName: string
  message: ChatMessage
  onClose: () => void
  onSaved: (blueprint: CourseBlueprint) => void
  initialContent?: CourseBlueprintContent
}

const emptyForm = (courseName: string): CourseBlueprintContent => ({
  title: `Course Blueprint for ${courseName}`,
  summary: '',
  weekly_plan: [],
  assessment_strategy: '',
  lab_strategy: '',
  teaching_preferences: {},
  open_questions: [],
  planning_horizon_weeks: null,
  plan_scope: null,
  assumptions: [],
  source_summary: '',
})

export function initialBlueprintForm(courseName: string, initialContent?: CourseBlueprintContent): CourseBlueprintContent {
  return initialContent
    ? { ...initialContent, weekly_plan: initialContent.weekly_plan.map((item) => ({ ...item, source_refs: [...(item.source_refs || [])] })), open_questions: [...initialContent.open_questions], assumptions: [...(initialContent.assumptions || [])], teaching_preferences: { ...initialContent.teaching_preferences } }
    : emptyForm(courseName)
}

export function CourseBlueprintReviewModal({ batchId, courseName, message, onClose, onSaved, initialContent }: Props) {
  const [form, setForm] = useState<CourseBlueprintContent>(() => initialBlueprintForm(courseName, initialContent))
  const [preferences, setPreferences] = useState<Array<{ key: string; value: string }>>(() =>
    Object.entries(initialContent?.teaching_preferences || {}).map(([key, value]) => ({ key, value })))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previous }
  }, [])

  function setField<K extends keyof CourseBlueprintContent>(key: K, value: CourseBlueprintContent[K]) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  function copySourceIntoSummary() {
    setField('summary', message.content)
  }

  async function save() {
    setSaving(true)
    setError('')
    try {
      const teaching_preferences = Object.fromEntries(
        preferences
          .map((item) => [item.key.trim(), item.value.trim()] as [string, string])
          .filter(([key, value]) => key && value),
      )
      const saved = await saveCourseBlueprintFromMessage(batchId, {
        ...form,
        teaching_preferences,
        weekly_plan: form.weekly_plan.map((item) => ({ ...item, week: Number(item.week) })),
        source_chat_id: message.chat_id,
        source_message_id: message.message_id,
        source_run_id: message.run_id || '',
      })
      onSaved(saved)
    } catch (err) {
      setError(normalizeApiErrorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  const canSave = hasSubstantiveBlueprintContent(form, preferences)

  return createPortal(
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center bg-slate-950/50 p-3 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Review Course Blueprint"
    >
      <div className="flex max-h-[94vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        {/* Header */}
        <header className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">{initialContent ? 'Edit Recommended Course Blueprint' : 'Review Course Blueprint'}</h2>
            <p className="text-sm text-slate-500">Nothing is saved until you confirm.</p>
          </div>
          <button onClick={onClose} disabled={saving} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </header>

        {/* Two-column body */}
        <div className="grid min-h-0 flex-1 md:grid-cols-2">

          {/* Left: Assistant recommendation (read-only reference) */}
          <section className="overflow-y-auto border-b bg-slate-50 p-5 md:border-b-0 md:border-r">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-700">Assistant recommendation</h3>
                <p className="mt-0.5 text-xs leading-5 text-slate-500">
                  Reference only. Nothing from this side is saved unless you copy it into the form.
                </p>
              </div>
              <button
                type="button"
                onClick={copySourceIntoSummary}
                className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100"
                title="Copy full source into the Summary field"
              >
                <ClipboardCopy className="h-3.5 w-3.5" />
                Copy source into Summary
              </button>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-700">
              <MarkdownBlock content={message.content} />
            </div>
          </section>

          {/* Right: Structured form */}
          <section className="space-y-4 overflow-y-auto p-5">
            <div>
              <h3 className="text-sm font-semibold text-slate-700">Course Blueprint to save</h3>
              <p className="mt-0.5 text-xs leading-5 text-slate-500">
                These structured fields are what will be saved and reused by future lesson, lab, and assessment generation.
              </p>
            </div>

            <TextField label="Title" value={form.title} onChange={(value) => setField('title', value)} />
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm font-medium text-slate-700">Planning horizon (weeks)<input type="number" min={1} max={104} value={form.planning_horizon_weeks || ''} onChange={(event) => setField('planning_horizon_weeks', event.target.value ? Number(event.target.value) : null)} className="mt-1 w-full rounded-lg border px-3 py-2 font-normal" /></label>
              <label className="text-sm font-medium text-slate-700">Plan scope<select value={form.plan_scope || ''} onChange={(event) => setField('plan_scope', (event.target.value || null) as CourseBlueprintContent['plan_scope'])} className="mt-1 w-full rounded-lg border px-3 py-2 font-normal"><option value="">Not specified</option><option value="full_course">Full course</option><option value="remaining_weeks">Remaining weeks</option><option value="strategy_only">Strategy only</option><option value="partial_update">Partial update</option></select></label>
            </div>
            <TextArea label="Summary" value={form.summary} onChange={(value) => setField('summary', value)} />

            <EditorSection
              title="Weekly plan"
              onAdd={() => setField('weekly_plan', [...form.weekly_plan, { week: form.weekly_plan.length + 1, theme: '' }])}
            >
              {form.weekly_plan.map((item, index) => (
                <WeeklyPlanRow
                  key={index}
                  item={item}
                  onChange={(updated) => {
                    const next = [...form.weekly_plan]
                    next[index] = updated
                    setField('weekly_plan', next)
                  }}
                  onRemove={() => setField('weekly_plan', form.weekly_plan.filter((_, i) => i !== index))}
                />
              ))}
            </EditorSection>

            <TextArea label="Assessment strategy" value={form.assessment_strategy} onChange={(value) => setField('assessment_strategy', value)} />
            <TextArea label="Lab strategy" value={form.lab_strategy} onChange={(value) => setField('lab_strategy', value)} />
            <TextArea label="Source summary" value={form.source_summary || ''} onChange={(value) => setField('source_summary', value)} />

            <EditorSection
              title="Teaching preferences"
              onAdd={() => setPreferences((items) => [...items, { key: '', value: '' }])}
            >
              {preferences.map((item, index) => (
                <div key={index} className="flex gap-2">
                  <input
                    value={item.key}
                    placeholder="Preference"
                    onChange={(e) => setPreferences((items) => items.map((x, i) => i === index ? { ...x, key: e.target.value } : x))}
                    className="w-2/5 rounded-lg border px-3 py-2 text-sm"
                  />
                  <input
                    value={item.value}
                    placeholder="Value"
                    onChange={(e) => setPreferences((items) => items.map((x, i) => i === index ? { ...x, value: e.target.value } : x))}
                    className="min-w-0 flex-1 rounded-lg border px-3 py-2 text-sm"
                  />
                  <button onClick={() => setPreferences((items) => items.filter((_, i) => i !== index))} className="text-red-500" aria-label="Remove preference">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </EditorSection>

            <EditorSection
              title="Open questions"
              onAdd={() => setField('open_questions', [...form.open_questions, ''])}
            >
              {form.open_questions.map((question, index) => (
                <div key={index} className="flex gap-2">
                  <input
                    value={question}
                    onChange={(e) => {
                      const next = [...form.open_questions]
                      next[index] = e.target.value
                      setField('open_questions', next)
                    }}
                    className="min-w-0 flex-1 rounded-lg border px-3 py-2 text-sm"
                    placeholder="Open question"
                  />
                  <button onClick={() => setField('open_questions', form.open_questions.filter((_, i) => i !== index))} className="text-red-500" aria-label="Remove question">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </EditorSection>

            <EditorSection
              title="Assumptions"
              onAdd={() => setField('assumptions', [...(form.assumptions || []), ''])}
            >
              {(form.assumptions || []).map((assumption, index) => (
                <div key={index} className="flex gap-2">
                  <input value={assumption} onChange={(event) => setField('assumptions', (form.assumptions || []).map((item, itemIndex) => itemIndex === index ? event.target.value : item))} className="min-w-0 flex-1 rounded-lg border px-3 py-2 text-sm" placeholder="Assumption" />
                  <button onClick={() => setField('assumptions', (form.assumptions || []).filter((_, itemIndex) => itemIndex !== index))} className="text-red-500" aria-label="Remove assumption"><Trash2 className="h-4 w-4" /></button>
                </div>
              ))}
            </EditorSection>

            {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

            {!canSave && (
              <p className="text-xs text-slate-500">
                Add a summary, weekly plan, strategy, preference, or open question before saving.
              </p>
            )}
          </section>
        </div>

        {/* Footer */}
        <footer className="flex justify-end gap-3 border-t p-4">
          <button
            onClick={onClose}
            disabled={saving}
            className="rounded-lg border px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={() => void save()}
            disabled={saving || !canSave}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
            title={!canSave ? 'Add substantive content before saving' : undefined}
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Save Course Blueprint
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  )
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function WeeklyPlanRow({
  item,
  onChange,
  onRemove,
}: {
  item: CourseBlueprintWeeklyPlanItem
  onChange: (updated: CourseBlueprintWeeklyPlanItem) => void
  onRemove: () => void
}) {
  return (
    <div className="space-y-2 rounded-xl border border-slate-200 p-3">
      {item.source_status && <div className="text-xs font-medium text-emerald-700">{sourceStatusLabel(item.source_status)}</div>}
      <div className="flex gap-2">
        <input
          type="number"
          min={1}
          value={item.week}
          onChange={(e) => onChange({ ...item, week: Number(e.target.value) })}
          className="w-20 rounded-lg border px-3 py-2 text-sm"
          aria-label="Week"
        />
        <input
          value={item.theme}
          placeholder="Theme"
          onChange={(e) => onChange({ ...item, theme: e.target.value })}
          className="min-w-0 flex-1 rounded-lg border px-3 py-2 text-sm"
        />
        <button onClick={onRemove} className="text-red-500" aria-label="Remove week">
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
      {(['lesson_goal', 'lab_goal', 'assessment_idea', 'notes'] as const).map((key) => (
        <input
          key={key}
          value={item[key] || ''}
          placeholder={key.replaceAll('_', ' ')}
          onChange={(e) => onChange({ ...item, [key]: e.target.value })}
          className="w-full rounded-lg border px-3 py-2 text-sm"
        />
      ))}
      {item.source_refs && item.source_refs.length > 0 && <p className="text-xs text-slate-500">Sources: {item.source_refs.join(', ')}</p>}
    </div>
  )
}

function sourceStatusLabel(status: NonNullable<CourseBlueprintWeeklyPlanItem['source_status']>) {
  return ({
    generated_artifact: 'From generated artifact',
    saved_blueprint: 'From saved blueprint',
    user_provided: 'From your instruction',
    proposed: 'Proposed',
    unknown: 'Source unknown',
  } as const)[status]
}

function TextField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block text-sm font-medium text-slate-700">
      {label}
      <input value={value} onChange={(e) => onChange(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal" />
    </label>
  )
}

function TextArea({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block text-sm font-medium text-slate-700">
      {label}
      <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={3} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal" />
    </label>
  )
}

function EditorSection({ title, onAdd, children }: { title: string; onAdd: () => void; children: ReactNode }) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-medium text-slate-700">{title}</h3>
        <button type="button" onClick={onAdd} className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
          <Plus className="h-3.5 w-3.5" />
          Add
        </button>
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  )
}
