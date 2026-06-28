import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Loader2, Plus, Trash2, X } from 'lucide-react'
import type { ChatMessage } from '../../../entity/Chat'
import {
  saveCourseBlueprintFromMessage,
  type CourseBlueprint,
  type CourseBlueprintContent,
} from '../../../services/courseBlueprintService'

type Props = {
  batchId: string
  courseName: string
  message: ChatMessage
  onClose: () => void
  onSaved: (blueprint: CourseBlueprint) => void
}

const emptyForm = (courseName: string): CourseBlueprintContent => ({
  title: `Course Blueprint for ${courseName}`,
  summary: '', weekly_plan: [], assessment_strategy: '', lab_strategy: '',
  teaching_preferences: {}, open_questions: [],
})

export function CourseBlueprintReviewModal({ batchId, courseName, message, onClose, onSaved }: Props) {
  const [form, setForm] = useState<CourseBlueprintContent>(() => emptyForm(courseName))
  const [preferences, setPreferences] = useState<Array<{ key: string; value: string }>>([])
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

  async function save() {
    setSaving(true)
    setError('')
    try {
      const teaching_preferences = Object.fromEntries(
        preferences.map((item) => [item.key.trim(), item.value.trim()]).filter(([key, value]) => key && value),
      )
      const saved = await saveCourseBlueprintFromMessage(batchId, {
        ...form, teaching_preferences,
        weekly_plan: form.weekly_plan.map((item) => ({ ...item, week: Number(item.week) })),
        source_chat_id: message.chat_id,
        source_message_id: message.message_id,
        source_run_id: message.run_id || '',
      })
      onSaved(saved)
    } catch (err) {
      const detail = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail
      setError(detail || 'Could not save the Course Blueprint.')
    } finally {
      setSaving(false)
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-slate-950/50 p-3 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Review Course Blueprint">
      <div className="flex max-h-[94vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <header className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div><h2 className="text-lg font-semibold text-slate-900">Review Course Blueprint</h2><p className="text-sm text-slate-500">Nothing is saved until you confirm.</p></div>
          <button onClick={onClose} disabled={saving} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="Close"><X className="h-5 w-5" /></button>
        </header>
        <div className="grid min-h-0 flex-1 md:grid-cols-2">
          <section className="overflow-y-auto border-b bg-slate-50 p-5 md:border-b-0 md:border-r">
            <h3 className="mb-3 text-sm font-semibold text-slate-700">Source assistant response</h3>
            <div className="whitespace-pre-wrap rounded-xl border border-slate-200 bg-white p-4 text-sm leading-6 text-slate-700">{message.content}</div>
          </section>
          <section className="space-y-4 overflow-y-auto p-5">
            <TextField label="Title" value={form.title} onChange={(value) => setField('title', value)} />
            <TextArea label="Summary" value={form.summary} onChange={(value) => setField('summary', value)} />
            <EditorSection title="Weekly plan" onAdd={() => setField('weekly_plan', [...form.weekly_plan, { week: form.weekly_plan.length + 1, theme: '' }])}>
              {form.weekly_plan.map((item, index) => (
                <div key={index} className="space-y-2 rounded-xl border border-slate-200 p-3">
                  <div className="flex gap-2"><input type="number" min={1} value={item.week} onChange={(e) => { const next=[...form.weekly_plan]; next[index]={...item,week:Number(e.target.value)}; setField('weekly_plan',next)}} className="w-20 rounded-lg border px-3 py-2 text-sm" aria-label="Week" /><input value={item.theme} placeholder="Theme" onChange={(e) => { const next=[...form.weekly_plan]; next[index]={...item,theme:e.target.value}; setField('weekly_plan',next)}} className="min-w-0 flex-1 rounded-lg border px-3 py-2 text-sm" /><button onClick={() => setField('weekly_plan', form.weekly_plan.filter((_, i) => i !== index))} className="text-red-500" aria-label="Remove week"><Trash2 className="h-4 w-4" /></button></div>
                  {(['lesson_goal','lab_goal','assessment_idea','notes'] as const).map((key) => <input key={key} value={item[key] || ''} placeholder={key.replaceAll('_',' ')} onChange={(e) => { const next=[...form.weekly_plan]; next[index]={...item,[key]:e.target.value}; setField('weekly_plan',next)}} className="w-full rounded-lg border px-3 py-2 text-sm" />)}
                </div>
              ))}
            </EditorSection>
            <TextArea label="Assessment strategy" value={form.assessment_strategy} onChange={(value) => setField('assessment_strategy', value)} />
            <TextArea label="Lab strategy" value={form.lab_strategy} onChange={(value) => setField('lab_strategy', value)} />
            <EditorSection title="Teaching preferences" onAdd={() => setPreferences((items) => [...items, { key: '', value: '' }])}>
              {preferences.map((item,index) => <div key={index} className="flex gap-2"><input value={item.key} placeholder="Preference" onChange={(e)=>setPreferences((items)=>items.map((x,i)=>i===index?{...x,key:e.target.value}:x))} className="w-2/5 rounded-lg border px-3 py-2 text-sm"/><input value={item.value} placeholder="Value" onChange={(e)=>setPreferences((items)=>items.map((x,i)=>i===index?{...x,value:e.target.value}:x))} className="min-w-0 flex-1 rounded-lg border px-3 py-2 text-sm"/><button onClick={()=>setPreferences((items)=>items.filter((_,i)=>i!==index))} className="text-red-500"><Trash2 className="h-4 w-4"/></button></div>)}
            </EditorSection>
            <EditorSection title="Open questions" onAdd={() => setField('open_questions', [...form.open_questions, ''])}>
              {form.open_questions.map((question,index)=><div key={index} className="flex gap-2"><input value={question} onChange={(e)=>{const next=[...form.open_questions];next[index]=e.target.value;setField('open_questions',next)}} className="min-w-0 flex-1 rounded-lg border px-3 py-2 text-sm" placeholder="Open question"/><button onClick={()=>setField('open_questions',form.open_questions.filter((_,i)=>i!==index))} className="text-red-500"><Trash2 className="h-4 w-4"/></button></div>)}
            </EditorSection>
            {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
          </section>
        </div>
        <footer className="flex justify-end gap-3 border-t p-4"><button onClick={onClose} disabled={saving} className="rounded-lg border px-4 py-2 text-sm">Cancel</button><button onClick={save} disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{saving && <Loader2 className="h-4 w-4 animate-spin"/>}Save Course Blueprint</button></footer>
      </div>
    </div>, document.body,
  )
}

function TextField({label,value,onChange}:{label:string;value:string;onChange:(value:string)=>void}) { return <label className="block text-sm font-medium text-slate-700">{label}<input value={value} onChange={(e)=>onChange(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal" /></label> }
function TextArea({label,value,onChange}:{label:string;value:string;onChange:(value:string)=>void}) { return <label className="block text-sm font-medium text-slate-700">{label}<textarea value={value} onChange={(e)=>onChange(e.target.value)} rows={3} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal" /></label> }
function EditorSection({title,onAdd,children}:{title:string;onAdd:()=>void;children:ReactNode}) { return <div><div className="mb-2 flex items-center justify-between"><h3 className="text-sm font-medium text-slate-700">{title}</h3><button type="button" onClick={onAdd} className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700"><Plus className="h-3.5 w-3.5"/>Add</button></div><div className="space-y-2">{children}</div></div> }
