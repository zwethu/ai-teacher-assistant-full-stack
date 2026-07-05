import { useCallback, useEffect, useState } from 'react'
import { Archive, Loader2, Pencil, Plus, RefreshCw, Sparkles, Trash2, X } from 'lucide-react'
import {
  archiveCurrentCourseBlueprint,
  getCurrentCourseBlueprint,
  listCourseBlueprintHistory,
  updateCurrentCourseBlueprint,
  type CourseBlueprint,
  type CourseBlueprintContent,
} from '../../../services/courseBlueprintService'
import { getBatchById } from '../../../services/batchService'
import type { Batch } from '../../../entity/Batch'
import { useGenerationRun } from '../../../hooks/useGenerationRun'
import { GenerationWorkspace } from '../../../components/generation/GenerationWorkspace'
import { formatDateTime } from '../../../utils/formatDate'

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
  const run = useGenerationRun(batch)

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

  async function archive() {
    if (!current || !window.confirm(`Archive Course Blueprint v${current.version}?`)) return
    setSaving(true); setError('')
    try { await archiveCurrentCourseBlueprint(batchId); await refresh() }
    catch { setError('Could not archive the Course Blueprint.') }
    finally { setSaving(false) }
  }

  if (loading) return <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-emerald-600" /></div>

  return <div className="space-y-6">
    {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
    {!current ? <div className="rounded-2xl border border-dashed border-slate-300 bg-white/60 px-6 py-14 text-center"><h2 className="font-semibold text-slate-800">No active Course Plan</h2><p className="mt-2 text-sm text-slate-500">Generate a plan with AI, or save one from an assistant message’s action menu in Chat.</p><button onClick={() => setGenerating(true)} disabled={!batch} className="mt-4 inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"><Sparkles className="h-4 w-4"/>Generate with AI</button></div> :
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3"><div><div className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Current · Version {current.version}</div><h2 className="mt-1 text-xl font-bold text-slate-900">{current.title}</h2><p className="text-xs text-slate-400">Updated {formatDateTime(current.updated_at || current.created_at || '')}</p></div><div className="flex gap-2"><button onClick={() => setGenerating(true)} disabled={!batch} className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm text-white hover:bg-emerald-700 disabled:opacity-60"><Sparkles className="h-4 w-4"/>Generate</button><button onClick={beginEdit} className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm"><Pencil className="h-4 w-4"/>Edit as new version</button><button onClick={archive} disabled={saving} className="inline-flex items-center gap-2 rounded-lg border border-red-200 px-3 py-2 text-sm text-red-700"><Archive className="h-4 w-4"/>Archive</button></div></div>
        <BlueprintView blueprint={current}/>
      </section>}
    <section><div className="mb-3 flex items-center justify-between"><h2 className="font-semibold text-slate-800">Version history</h2><button onClick={() => void refresh()} className="rounded p-1 text-slate-500"><RefreshCw className="h-4 w-4"/></button></div><div className="space-y-2">{history.length === 0 ? <p className="text-sm text-slate-500">No saved versions yet.</p> : history.map((item)=><details key={item.blueprint_id} className="rounded-xl border border-slate-200 bg-white px-4 py-3"><summary className="cursor-pointer text-sm font-medium text-slate-800">v{item.version} · {item.title} <span className="ml-2 text-xs font-normal text-slate-400">{item.status}</span></summary><div className="mt-4"><BlueprintView blueprint={item}/></div></details>)}</div></section>
    {editing && form && <EditBlueprintModal form={form} setForm={setForm} saving={saving} onClose={()=>setEditing(false)} onSave={()=>void saveEdit()}/>}
    {generating && batch && <GeneratePlanModal batch={batch} run={run} onClose={() => { setGenerating(false); void refresh() }} />}
  </div>
}

function GeneratePlanModal({
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
  const started = run.messages.length > 0

  async function handleGenerate() {
    if (run.sending) return
    const lines = [
      `Generate a course plan (blueprint) for ${batch.course_name}.`,
      `Planning horizon: ${horizon} weeks.`,
    ]
    if (instructions.trim()) lines.push(`Instructions: ${instructions.trim()}`)
    await run.generate({ workflowType: 'course_blueprint', message: lines.join('\n'), webSearch: web })
  }

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-slate-950/50 p-4">
      <div className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Generate Course Plan</h2>
            <p className="text-sm text-slate-500">The agent uses this space’s Course-Space files, web search, and any saved artifacts.</p>
          </div>
          <button onClick={onClose}><X className="h-5 w-5" /></button>
        </div>

        {!started ? (
          <div className="space-y-4 p-6">
            <div className="flex items-center gap-4">
              <label className="text-sm font-medium text-slate-700">Planning horizon (weeks)
                <input type="number" min={1} max={52} value={horizon} onChange={(e) => setHorizon(Number(e.target.value || 1))}
                  className="ml-2 w-24 rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
              </label>
              <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={web} onChange={(e) => setWeb(e.target.checked)} /> Web search
              </label>
            </div>
            <label className="block text-sm font-medium text-slate-700">Instructions (optional)
              <textarea rows={3} value={instructions} onChange={(e) => setInstructions(e.target.value)}
                placeholder="Focus areas, constraints, prior materials to align with…"
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
            </label>
            <div className="flex justify-end">
              <button onClick={() => void handleGenerate()} disabled={run.sending}
                className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60">
                {run.sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                Generate outline
              </button>
            </div>
          </div>
        ) : (
          <div className="min-h-[24rem] flex-1 overflow-hidden p-4">
            <GenerationWorkspace batch={batch} run={run}
              emptyHint="Drafting the plan outline for your approval…" />
          </div>
        )}
      </div>
    </div>
  )
}

function BlueprintView({blueprint}:{blueprint:CourseBlueprint}) { return <div className="space-y-5 text-sm text-slate-700">{(blueprint.plan_scope||blueprint.planning_horizon_weeks)&&<p className="text-xs text-slate-500">{blueprint.plan_scope?.replaceAll('_',' ')}{blueprint.plan_scope&&blueprint.planning_horizon_weeks?' · ':''}{blueprint.planning_horizon_weeks?`${blueprint.planning_horizon_weeks} weeks`:''}</p>}{blueprint.summary && <Section title="Summary"><p className="whitespace-pre-wrap">{blueprint.summary}</p></Section>}{blueprint.weekly_plan.length>0&&<Section title="Weekly plan"><div className="overflow-x-auto"><table className="w-full text-left"><thead><tr className="border-b text-xs text-slate-500"><th className="p-2">Week</th><th className="p-2">Theme</th><th className="p-2">Lesson goal</th><th className="p-2">Lab goal</th><th className="p-2">Assessment</th><th className="p-2">Source</th></tr></thead><tbody>{blueprint.weekly_plan.map((row)=><tr key={row.week} className="border-b align-top"><td className="p-2 font-semibold">{row.week}</td><td className="p-2">{row.theme}</td><td className="p-2">{row.lesson_goal}</td><td className="p-2">{row.lab_goal}</td><td className="p-2">{row.assessment_idea}</td><td className="p-2 text-xs">{row.source_status?.replaceAll('_',' ')}</td></tr>)}</tbody></table></div></Section>}{blueprint.assessment_strategy&&<Section title="Assessment strategy"><p className="whitespace-pre-wrap">{blueprint.assessment_strategy}</p></Section>}{blueprint.lab_strategy&&<Section title="Lab strategy"><p className="whitespace-pre-wrap">{blueprint.lab_strategy}</p></Section>}{Object.keys(blueprint.teaching_preferences).length>0&&<Section title="Teaching preferences"><dl>{Object.entries(blueprint.teaching_preferences).map(([key,value])=><div key={key} className="flex gap-2"><dt className="font-medium">{key}:</dt><dd>{value}</dd></div>)}</dl></Section>}{blueprint.open_questions.length>0&&<Section title="Open questions"><ul className="list-disc pl-5">{blueprint.open_questions.map((q,i)=><li key={i}>{q}</li>)}</ul></Section>}{(blueprint.assumptions||[]).length>0&&<Section title="Assumptions"><ul className="list-disc pl-5">{(blueprint.assumptions||[]).map((q,i)=><li key={i}>{q}</li>)}</ul></Section>}{blueprint.source_summary&&<Section title="Source summary"><p className="whitespace-pre-wrap">{blueprint.source_summary}</p></Section>}</div> }
function Section({title,children}:{title:string;children:React.ReactNode}) { return <section><h3 className="mb-1 font-semibold text-slate-800">{title}</h3>{children}</section> }

function EditBlueprintModal({form,setForm,saving,onClose,onSave}:{form:CourseBlueprintContent;setForm:(value:CourseBlueprintContent)=>void;saving:boolean;onClose:()=>void;onSave:()=>void}) {
  const update=(key:keyof CourseBlueprintContent,value:unknown)=>setForm({...form,[key]:value})
  return <div className="fixed inset-0 z-[300] flex items-center justify-center bg-slate-950/50 p-4"><div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl"><div className="mb-5 flex justify-between"><div><h2 className="text-lg font-semibold">Edit Course Blueprint</h2><p className="text-sm text-slate-500">Saving creates a new immutable version.</p></div><button onClick={onClose}><X className="h-5 w-5"/></button></div><div className="space-y-4"><Input label="Title" value={form.title} onChange={(v)=>update('title',v)}/><Area label="Summary" value={form.summary} onChange={(v)=>update('summary',v)}/><div><div className="mb-2 flex justify-between"><label className="text-sm font-medium">Weekly plan</label><button onClick={()=>update('weekly_plan',[...form.weekly_plan,{week:form.weekly_plan.length+1,theme:''}])} className="inline-flex items-center gap-1 text-xs text-emerald-700"><Plus className="h-3 w-3"/>Add week</button></div>{form.weekly_plan.map((row,index)=><div key={index} className="mb-3 space-y-2 rounded-xl border p-3"><div className="flex gap-2"><input type="number" min={1} value={row.week} onChange={(e)=>update('weekly_plan',form.weekly_plan.map((x,i)=>i===index?{...x,week:Number(e.target.value)}:x))} className="w-20 rounded border px-2"/><input value={row.theme} placeholder="Theme" onChange={(e)=>update('weekly_plan',form.weekly_plan.map((x,i)=>i===index?{...x,theme:e.target.value}:x))} className="min-w-0 flex-1 rounded border px-3 py-2"/><button onClick={()=>update('weekly_plan',form.weekly_plan.filter((_,i)=>i!==index))} className="text-red-500"><Trash2 className="h-4 w-4"/></button></div>{(['lesson_goal','lab_goal','assessment_idea','notes'] as const).map((key)=><input key={key} value={row[key] || ''} placeholder={key.replaceAll('_',' ')} onChange={(e)=>update('weekly_plan',form.weekly_plan.map((x,i)=>i===index?{...x,[key]:e.target.value}:x))} className="w-full rounded border px-3 py-2"/>)}</div>)}</div><Area label="Assessment strategy" value={form.assessment_strategy} onChange={(v)=>update('assessment_strategy',v)}/><Area label="Lab strategy" value={form.lab_strategy} onChange={(v)=>update('lab_strategy',v)}/><Area label="Teaching preferences (one key: value per line)" value={Object.entries(form.teaching_preferences).map(([k,v])=>`${k}: ${v}`).join('\n')} onChange={(v)=>update('teaching_preferences',Object.fromEntries(v.split('\n').map(line=>line.split(':',2).map(x=>x.trim())).filter(parts=>parts.length===2&&parts[0]&&parts[1])))}/><Area label="Open questions (one per line)" value={form.open_questions.join('\n')} onChange={(v)=>update('open_questions',v.split('\n').filter(Boolean))}/></div><div className="mt-6 flex justify-end gap-3"><button onClick={onClose} className="rounded-lg border px-4 py-2">Cancel</button><button onClick={onSave} disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-white">{saving&&<Loader2 className="h-4 w-4 animate-spin"/>}Save new version</button></div></div></div>
}
function Input({label,value,onChange}:{label:string;value:string;onChange:(v:string)=>void}) { return <label className="block text-sm font-medium">{label}<input value={value} onChange={(e)=>onChange(e.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2 font-normal"/></label> }
function Area({label,value,onChange}:{label:string;value:string;onChange:(v:string)=>void}) { return <label className="block text-sm font-medium">{label}<textarea rows={3} value={value} onChange={(e)=>onChange(e.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2 font-normal"/></label> }
