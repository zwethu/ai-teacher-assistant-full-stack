import { useCallback, useEffect, useState } from 'react'
import { Archive, Pencil, Plus, RefreshCw, RotateCcw, Sparkles, Trash2, X } from 'lucide-react'
import {
  archiveCurrentCourseBlueprint,
  deleteCourseBlueprintVersion,
  getCurrentCourseBlueprint,
  listCourseBlueprintHistory,
  revertToCourseBlueprintVersion,
  updateCurrentCourseBlueprint,
  type CourseBlueprint,
  type CourseBlueprintContent,
} from '../../../services/courseBlueprintService'
import { getBatchById } from '../../../services/batchService'
import type { Batch } from '../../../entity/Batch'
import { useGenerationRun } from '../../../hooks/useGenerationRun'
import { GenerationRunView } from '../../../components/generation/GenerationRunView'
import { GenerationAttachments } from '../../../components/generation/GenerationAttachments'
import { formatDateTime } from '../../../utils/formatDate'
import { Spinner, Button } from '../../../design-system'
import { CHECKBOX_CLASS, FIELD_CLASS, TEXTAREA_CLASS } from '../../../components/ui/fieldStyles'
import { BTN_SECONDARY } from '../constants'
import { undoable, usePendingUndo } from '../../../components/ui/undoStore'

export function PlanningTab({ batchId }: { batchId: string }) {
  const [current, setCurrent] = useState<CourseBlueprint | null>(null)
  const [history, setHistory] = useState<CourseBlueprint[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<CourseBlueprintContent | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [batch, setBatch] = useState<Batch | null>(null)
  const [generating, setGenerating] = useState(false)
  const run = useGenerationRun(batch, 'course_blueprint')
  const pendingUndo = usePendingUndo()
  const visibleHistory = history.filter((item) => !pendingUndo.has(item.blueprint_id))

  // Reopen the inline generation panel when a run is active/loaded — e.g. after
  // navigating away and back, the run keeps going in the background.
  useEffect(() => {
    if (run.messages.length > 0 || run.currentRunId) setGenerating(true)
  }, [run.messages.length, run.currentRunId])

  useEffect(() => {
    let cancelled = false
    getBatchById(batchId).then((b) => { if (!cancelled) setBatch(b) }).catch(() => {})
    return () => { cancelled = true }
  }, [batchId])

  const refresh = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const [blueprint, versions] = await Promise.all([
        getCurrentCourseBlueprint(batchId), listCourseBlueprintHistory(batchId),
      ])
      setCurrent(blueprint); setHistory(versions)
    } catch { setError('Could not load the Course Blueprint.') }
    finally { setLoading(false) }
  }, [batchId])

  useEffect(() => { void refresh() }, [refresh])

  function beginEdit() {
    if (!current) return
    setForm({ title: current.title, summary: current.summary, weekly_plan: current.weekly_plan,
      assessment_strategy: current.assessment_strategy, lab_strategy: current.lab_strategy,
      teaching_preferences: current.teaching_preferences, open_questions: current.open_questions,
      planning_horizon_weeks: current.planning_horizon_weeks, plan_scope: current.plan_scope,
      assumptions: current.assumptions || [], source_summary: current.source_summary || '' })
    setEditing(true)
  }

  async function saveEdit() {
    if (!form) return
    setSaving(true); setError('')
    try { await updateCurrentCourseBlueprint(batchId, form); setEditing(false); await refresh() }
    catch (err) { setError((err as {response?:{data?:{detail?:string}}}).response?.data?.detail || 'Could not save the new version.') }
    finally { setSaving(false) }
  }

  /* Archiving and reverting no longer ask. Both were confirming something that
     is already undoable by construction: the archived version stays in the
     history below, and reverting explicitly says it keeps history and creates
     a new version rather than overwriting one. A dialog in front of a
     reversible action spends the lecturer's attention and buys nothing —
     worse, it trains them to dismiss the two dialogs that do matter. */
  async function archive() {
    if (!current) return
    setSaving(true); setError('')
    try { await archiveCurrentCourseBlueprint(batchId); await refresh() }
    catch { setError('Could not archive the Course Blueprint.') }
    finally { setSaving(false) }
  }

  async function revertVersion(blueprintId: string) {
    setSaving(true); setError('')
    try { await revertToCourseBlueprintVersion(batchId, blueprintId); await refresh() }
    catch { setError('Could not revert to this version.') }
    finally { setSaving(false) }
  }

  // This one is a real deletion, so it gets the undo window instead.
  function deleteVersion(blueprintId: string, version: number) {
    undoable({
      id: blueprintId,
      message: `Deleted Course Plan v${version}.`,
      commit: async () => {
        try { await deleteCourseBlueprintVersion(batchId, blueprintId); await refresh() }
        catch { setError('Could not delete this version.') }
      },
    })
  }

  if (loading) return <div className="flex justify-center py-16"><Spinner size={24} /></div>

  return <div className="space-y-6">
    {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
    {generating && batch && <GeneratePlanPanel batch={batch} run={run} onClose={() => { setGenerating(false); void refresh() }} />}
    {!generating && (!current ? <div className="rounded-2xl border border-dashed border-slate-300 bg-white/60 px-6 py-14 text-center"><h2 className="font-semibold text-slate-800">No active Course Plan</h2><p className="mt-2 text-sm text-slate-500">Generate a plan with AI, or save one from an assistant message’s action menu in Chat.</p><Button type="button" onClick={() => setGenerating(true)} disabled={!batch} leadingIcon={<Sparkles className="h-4 w-4" />} className="mt-4">Generate with AI</Button></div> :
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3"><div><div className="text-xs font-semibold uppercase tracking-wide text-violet-700">Current · Version {current.version}</div><h2 className="mt-1 text-xl font-bold text-slate-900">{current.title}</h2><p className="text-xs text-slate-400">Updated {formatDateTime(current.updated_at || current.created_at || '')}</p></div><div className="flex flex-wrap gap-2"><Button type="button" onClick={() => setGenerating(true)} disabled={!batch} leadingIcon={<Sparkles className="h-4 w-4" />}>Generate</Button><Button type="button" variant="secondary" onClick={beginEdit} leadingIcon={<Pencil className="h-4 w-4" />}>Edit as new version</Button><Button type="button" variant="danger" onClick={archive} disabled={saving} leadingIcon={<Archive className="h-4 w-4" />}>Archive</Button></div></div>
        <BlueprintView blueprint={current}/>
      </section>)}
    <section><div className="mb-3 flex items-center justify-between"><h2 className="font-semibold text-slate-800">Version history</h2><button onClick={() => void refresh()} className="rounded p-1 text-slate-500"><RefreshCw className="h-4 w-4"/></button></div><div className="space-y-2">{visibleHistory.length === 0 ? <p className="text-sm text-slate-500">No saved versions yet.</p> : visibleHistory.map((item)=><details key={item.blueprint_id} className="rounded-xl border border-slate-200 bg-white px-4 py-3"><summary className="cursor-pointer text-sm font-medium text-slate-800">v{item.version} · {item.title} <span className="ml-2 text-xs font-normal text-slate-400">{item.status}</span></summary><div className="mt-4"><BlueprintView blueprint={item}/></div><div className="mt-3 flex flex-wrap gap-2 border-t border-slate-100 pt-3">{item.blueprint_id !== current?.blueprint_id && <button onClick={()=>void revertVersion(item.blueprint_id)} disabled={saving} className="inline-flex items-center gap-1.5 rounded-md border border-violet-200 px-3 py-1.5 text-xs font-medium text-violet-700 hover:bg-violet-50 disabled:opacity-60"><RotateCcw className="h-3.5 w-3.5"/>Make current</button>}<button onClick={()=>deleteVersion(item.blueprint_id, item.version)} disabled={saving} className="inline-flex items-center gap-1.5 rounded-md border border-red-200 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-60"><Trash2 className="h-3.5 w-3.5"/>Delete</button></div></details>)}</div></section>
    {editing && form && <EditBlueprintModal form={form} setForm={setForm} saving={saving} onClose={()=>setEditing(false)} onSave={()=>void saveEdit()}/>}
  </div>
}

function GeneratePlanPanel({
  batch,
  run,
  onClose,
}: {
  batch: Batch
  run: ReturnType<typeof useGenerationRun>
  onClose: () => void
}) {
  const [horizon, setHorizon] = useState(12)
  const [instructions, setInstructions] = useState('')
  const [web, setWeb] = useState(true)
  const started = run.messages.length > 0 || Boolean(run.currentRunId)
  const missing: string[] = []
  if (!(Number(horizon) >= 1)) missing.push('a planning horizon')

  async function handleGenerate() {
    if (run.sending || missing.length > 0) return
    const lines = [
      `Generate a course plan (blueprint) for ${batch.course_name}.`,
      `Planning horizon: ${horizon} weeks.`,
      'Standalone form submission: required fields are confirmed. Do not ask clarifying questions for planning horizon; proceed with begin_course_blueprint_workflow.',
    ]
    if (instructions.trim()) lines.push(`Instructions: ${instructions.trim()}`)
    await run.generate({ workflowType: 'course_blueprint', message: lines.join('\n'), webSearch: web })
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Generate Course Plan</h2>
            <p className="text-sm text-slate-500">The agent uses this batch’s course materials, web search, and anything already generated for it.</p>
          </div>
          <button onClick={onClose}><X className="h-5 w-5" /></button>
        </div>

        {!started ? (
          <div className="space-y-4 p-6">
            <div className="flex items-center gap-4">
              <label className="text-sm font-medium text-slate-700">Planning horizon (weeks)
                <input type="number" min={1} max={52} required value={horizon} onChange={(e) => setHorizon(Number(e.target.value || 1))}
                  className={`ml-2 w-24 ${FIELD_CLASS} py-1.5`} />
              </label>
              <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={web} onChange={(e) => setWeb(e.target.checked)} className={CHECKBOX_CLASS} /> Web search
              </label>
            </div>
            <label className="block text-sm font-medium text-slate-700">Instructions (optional)
              <textarea rows={3} value={instructions} onChange={(e) => setInstructions(e.target.value)}
                placeholder="Focus areas, constraints, prior materials to align with…"
                className={`mt-1 ${TEXTAREA_CLASS}`} />
            </label>
            <GenerationAttachments run={run} />
            <div className="flex flex-col items-end gap-2">
              <Button
                type="button"
                onClick={() => void handleGenerate()}
                disabled={run.sending || missing.length > 0}
                loading={run.sending}
                leadingIcon={<Sparkles className="h-4 w-4" />}
              >
                Generate outline
              </Button>
              {missing.length > 0 && !run.sending && (
                <p className="text-xs text-slate-500">Add {missing.join(', ')} to continue.</p>
              )}
            </div>
          </div>
        ) : (
          <div className="min-h-[20rem] max-h-[70vh] overflow-y-auto">
            <GenerationRunView batch={batch} run={run} accent="primary"
              onBlueprintSaved={() => { run.reset(); onClose() }}
              emptyHint="Drafting the plan outline for your approval…" />
          </div>
        )}
    </section>
  )
}

function BlueprintView({blueprint}:{blueprint:CourseBlueprint}) { return <div className="space-y-5 text-sm text-slate-700">{(blueprint.plan_scope||blueprint.planning_horizon_weeks)&&<p className="text-xs text-slate-500">{blueprint.plan_scope?.replaceAll('_',' ')}{blueprint.plan_scope&&blueprint.planning_horizon_weeks?' · ':''}{blueprint.planning_horizon_weeks?`${blueprint.planning_horizon_weeks} weeks`:''}</p>}{blueprint.summary && <Section title="Summary"><p className="whitespace-pre-wrap">{blueprint.summary}</p></Section>}{blueprint.weekly_plan.length>0&&<Section title="Weekly plan"><div className="overflow-x-auto"><table className="w-full text-left"><thead><tr className="border-b border-slate-200 text-xs text-slate-500"><th className="p-2">Week</th><th className="p-2">Theme</th><th className="p-2">Lesson goal</th><th className="p-2">Lab goal</th><th className="p-2">Assessment</th><th className="p-2">Source</th></tr></thead><tbody>{blueprint.weekly_plan.map((row)=><tr key={row.week} className="border-b border-slate-100 align-top"><td className="p-2 font-semibold">{row.week}</td><td className="p-2">{row.theme}</td><td className="p-2">{row.lesson_goal}</td><td className="p-2">{row.lab_goal}</td><td className="p-2">{row.assessment_idea}</td><td className="p-2 text-xs">{row.source_status?.replaceAll('_',' ')}</td></tr>)}</tbody></table></div></Section>}{blueprint.assessment_strategy&&<Section title="Assessment strategy"><p className="whitespace-pre-wrap">{blueprint.assessment_strategy}</p></Section>}{blueprint.lab_strategy&&<Section title="Lab strategy"><p className="whitespace-pre-wrap">{blueprint.lab_strategy}</p></Section>}{Object.keys(blueprint.teaching_preferences).length>0&&<Section title="Teaching preferences"><dl>{Object.entries(blueprint.teaching_preferences).map(([key,value])=><div key={key} className="flex gap-2"><dt className="font-medium">{key}:</dt><dd>{value}</dd></div>)}</dl></Section>}{blueprint.open_questions.length>0&&<Section title="Open questions"><ul className="list-disc pl-5">{blueprint.open_questions.map((q,i)=><li key={i}>{q}</li>)}</ul></Section>}{(blueprint.assumptions||[]).length>0&&<Section title="Assumptions"><ul className="list-disc pl-5">{(blueprint.assumptions||[]).map((q,i)=><li key={i}>{q}</li>)}</ul></Section>}{blueprint.source_summary&&<Section title="Source summary"><p className="whitespace-pre-wrap">{blueprint.source_summary}</p></Section>}</div> }
function Section({title,children}:{title:string;children:React.ReactNode}) { return <section><h3 className="mb-1 font-semibold text-slate-800">{title}</h3>{children}</section> }

function EditBlueprintModal({form,setForm,saving,onClose,onSave}:{form:CourseBlueprintContent;setForm:(value:CourseBlueprintContent)=>void;saving:boolean;onClose:()=>void;onSave:()=>void}) {
  const update=(key:keyof CourseBlueprintContent,value:unknown)=>setForm({...form,[key]:value})
  return <div className="fixed inset-0 z-[300] flex items-center justify-center bg-slate-950/50 p-4"><div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl"><div className="mb-5 flex justify-between"><div><h2 className="text-lg font-semibold">Edit Course Blueprint</h2><p className="text-sm text-slate-500">Saving creates a new immutable version.</p></div><button onClick={onClose}><X className="h-5 w-5"/></button></div><div className="space-y-4"><Input label="Title" value={form.title} onChange={(v)=>update('title',v)}/><Area label="Summary" value={form.summary} onChange={(v)=>update('summary',v)}/><div><div className="mb-2 flex justify-between"><label className="text-sm font-medium">Weekly plan</label><button onClick={()=>update('weekly_plan',[...form.weekly_plan,{week:form.weekly_plan.length+1,theme:''}])} className="inline-flex items-center gap-1 text-xs text-violet-700"><Plus className="h-3 w-3"/>Add week</button></div>{form.weekly_plan.map((row,index)=><div key={index} className="mb-3 space-y-2 rounded-xl border border-slate-200 p-3"><div className="flex gap-2"><input type="number" min={1} value={row.week} onChange={(e)=>update('weekly_plan',form.weekly_plan.map((x,i)=>i===index?{...x,week:Number(e.target.value)}:x))} className={`w-20 ${FIELD_CLASS} px-2 py-1.5`}/><input value={row.theme} placeholder="Theme" onChange={(e)=>update('weekly_plan',form.weekly_plan.map((x,i)=>i===index?{...x,theme:e.target.value}:x))} className={`min-w-0 flex-1 ${FIELD_CLASS}`}/><button onClick={()=>update('weekly_plan',form.weekly_plan.filter((_,i)=>i!==index))} className="text-red-500"><Trash2 className="h-4 w-4"/></button></div>{(['lesson_goal','lab_goal','assessment_idea','notes'] as const).map((key)=><input key={key} value={row[key] || ''} placeholder={key.replaceAll('_',' ')} onChange={(e)=>update('weekly_plan',form.weekly_plan.map((x,i)=>i===index?{...x,[key]:e.target.value}:x))} className={FIELD_CLASS}/>)}</div>)}</div><Area label="Assessment strategy" value={form.assessment_strategy} onChange={(v)=>update('assessment_strategy',v)}/><Area label="Lab strategy" value={form.lab_strategy} onChange={(v)=>update('lab_strategy',v)}/><Area label="Teaching preferences (one key: value per line)" value={Object.entries(form.teaching_preferences).map(([k,v])=>`${k}: ${v}`).join('\n')} onChange={(v)=>update('teaching_preferences',Object.fromEntries(v.split('\n').map(line=>line.split(':',2).map(x=>x.trim())).filter(parts=>parts.length===2&&parts[0]&&parts[1])))}/><Area label="Open questions (one per line)" value={form.open_questions.join('\n')} onChange={(v)=>update('open_questions',v.split('\n').filter(Boolean))}/></div><div className="mt-6 flex justify-end gap-3"><button onClick={onClose} className={BTN_SECONDARY}>Cancel</button><Button onClick={onSave} loading={saving}>Save new version</Button></div></div></div>
}
function Input({label,value,onChange}:{label:string;value:string;onChange:(v:string)=>void}) { return <label className="block text-sm font-medium">{label}<input value={value} onChange={(e)=>onChange(e.target.value)} className={`mt-1 ${FIELD_CLASS} font-normal`}/></label> }
function Area({label,value,onChange}:{label:string;value:string;onChange:(v:string)=>void}) { return <label className="block text-sm font-medium">{label}<textarea rows={3} value={value} onChange={(e)=>onChange(e.target.value)} className={`mt-1 ${FIELD_CLASS} font-normal`}/></label> }
