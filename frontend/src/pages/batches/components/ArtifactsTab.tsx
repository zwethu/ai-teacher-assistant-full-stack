import { useMemo, useState } from 'react'
import { Copy, ExternalLink, FileText, Filter, Trash2 } from 'lucide-react'
import type { Artifact, ArtifactSummary } from '../../../services/artifactService'
import { formatDateTime } from '../../../utils/formatDate'

type Props = {
  artifacts: Artifact[]
  summary: ArtifactSummary | null
  loading: boolean
  onRefresh: () => void
  onDelete: (artifact: Artifact) => void
}

const TYPE_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'lesson_plan', label: 'Lesson Plans' },
  { value: 'lab', label: 'Labs' },
  { value: 'quiz', label: 'Assessments' },
  { value: 'email', label: 'Emails' },
]

const SUMMARY_TYPES = [
  ['lesson_plan', 'Lesson Plans'],
  ['lab', 'Labs'],
  ['quiz', 'Assessments'],
  ['email', 'Emails'],
] as const

function artifactTypeLabel(type: string) {
  return TYPE_OPTIONS.find((option) => option.value === type)?.label || type || 'Other'
}

function primaryUrl(artifact: Artifact): string {
  return artifact.form_url || artifact.doc_url || ''
}

function metadataString(artifact: Artifact, key: string): string {
  const value = artifact.metadata?.[key]
  return typeof value === 'string' ? value : ''
}

function copyLink(url: string) {
  if (!url) return
  void navigator.clipboard?.writeText(url)
}

export function ArtifactsTab({ artifacts, summary, loading, onRefresh, onDelete }: Props) {
  const [typeFilter, setTypeFilter] = useState('')
  const [currentOnly, setCurrentOnly] = useState(false)
  const [weekFilter, setWeekFilter] = useState('')
  const [search, setSearch] = useState('')
  const [versionsKey, setVersionsKey] = useState<string | null>(null)

  const weeks = useMemo(
    () =>
      Array.from(new Set(artifacts.map((artifact) => artifact.week).filter(Boolean) as number[]))
        .sort((a, b) => a - b),
    [artifacts],
  )

  const filtered = artifacts.filter((artifact) => {
    if (typeFilter && artifact.type !== typeFilter) return false
    if (currentOnly && !artifact.is_current) return false
    if (weekFilter && String(artifact.week || '') !== weekFilter) return false
    const q = search.trim().toLowerCase()
    if (q && !(artifact.title || '').toLowerCase().includes(q)) return false
    return true
  })

  const versionGroups = useMemo(() => {
    const map = new Map<string, Artifact[]>()
    for (const artifact of artifacts) {
      const key = `${artifact.type}:${artifact.week ?? ''}`
      const group = map.get(key) || []
      group.push(artifact)
      map.set(key, group)
    }
    for (const group of map.values()) {
      group.sort((a, b) => Number(b.version || 0) - Number(a.version || 0))
    }
    return map
  }, [artifacts])

  const activeVersions = versionsKey ? versionGroups.get(versionsKey) || [] : []

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        {SUMMARY_TYPES.map(([type, label]) => {
          const count = summary?.counts?.[type] || { current: 0, total: 0 }
          return (
            <div key={type} className="rounded-lg border border-slate-200 bg-white px-4 py-3">
              <div className="text-xs font-medium text-slate-500">{label}</div>
              <div className="mt-1 text-2xl font-semibold text-slate-900">{count.current}</div>
              <div className="text-xs text-slate-400">{count.total} total versions</div>
            </div>
          )
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {summary?.drive_root_folder_url && (
          <a
            href={summary.drive_root_folder_url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-md bg-violet-600 px-3 py-2 text-sm font-medium text-white hover:bg-violet-700"
          >
            <ExternalLink className="w-4 h-4" />
            Open Drive Folder
          </a>
        )}
        <button
          type="button"
          onClick={onRefresh}
          className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          <Filter className="w-4 h-4" />
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="rounded-md border border-slate-200 px-3 py-2 text-sm">
          {TYPE_OPTIONS.map((option) => (
            <option key={option.label} value={option.value}>{option.label}</option>
          ))}
        </select>
        <select value={weekFilter} onChange={(e) => setWeekFilter(e.target.value)} className="rounded-md border border-slate-200 px-3 py-2 text-sm">
          <option value="">All weeks</option>
          {weeks.map((week) => (
            <option key={week} value={week}>Week {week}</option>
          ))}
        </select>
        <label className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
          <input type="checkbox" checked={currentOnly} onChange={(e) => setCurrentOnly(e.target.checked)} />
          Current only
        </label>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search title"
          className="rounded-md border border-slate-200 px-3 py-2 text-sm"
        />
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        {loading ? (
          <div className="p-8 text-center text-sm text-slate-500">Loading artifacts...</div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">No artifacts found.</div>
        ) : (
          <div className="divide-y divide-slate-100">
            {filtered.map((artifact) => {
              const url = primaryUrl(artifact)
              const studentUrl = metadataString(artifact, 'student_doc_url')
              const versionsKeyForRow = `${artifact.type}:${artifact.week ?? ''}`
              return (
                <div key={artifact.id} className="grid grid-cols-1 xl:grid-cols-[1fr_auto] gap-3 p-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="inline-flex items-center gap-1 rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                        <FileText className="w-3 h-3" />
                        {artifactTypeLabel(artifact.type)}
                      </span>
                      {artifact.week && <span className="text-xs text-slate-500">Week {artifact.week}</span>}
                      <span className="text-xs text-slate-500">v{String(artifact.version || 1).padStart(2, '0')}</span>
                      {artifact.is_current && <span className="rounded bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-700">Current</span>}
                      {artifact.status && !artifact.is_current && <span className="rounded bg-slate-50 px-2 py-0.5 text-xs text-slate-500">{artifact.status}</span>}
                    </div>
                    <div className="mt-1 truncate text-sm font-semibold text-slate-900" title={artifact.drive_file_name || artifact.title}>
                      {artifact.drive_file_name || artifact.title}
                    </div>
                    {artifact.created_at && (
                      <div className="mt-1 text-xs text-slate-400">{formatDateTime(artifact.created_at)}</div>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 xl:justify-end">
                    {url && <a href={url} target="_blank" rel="noreferrer" className="text-sm font-medium text-violet-700 hover:underline">Open</a>}
                    {studentUrl && <a href={studentUrl} target="_blank" rel="noreferrer" className="text-sm font-medium text-violet-700 hover:underline">Student</a>}
                    {url && <button type="button" onClick={() => copyLink(url)} className="p-1.5 text-slate-500 hover:text-slate-800" title="Copy link"><Copy className="w-4 h-4" /></button>}
                    <button type="button" onClick={() => setVersionsKey(versionsKeyForRow)} className="text-sm text-slate-600 hover:text-slate-900">Versions</button>
                    <button type="button" onClick={() => onDelete(artifact)} className="p-1.5 text-slate-400 hover:text-red-600" title="Delete"><Trash2 className="w-4 h-4" /></button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {versionsKey && (
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-slate-800">Versions</h3>
            <button type="button" onClick={() => setVersionsKey(null)} className="text-sm text-slate-500 hover:text-slate-800">Close</button>
          </div>
          <div className="mt-3 space-y-2">
            {activeVersions.map((artifact) => (
              <div key={artifact.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-slate-50 px-3 py-2 text-sm">
                <span>v{String(artifact.version || 1).padStart(2, '0')} - {artifact.title}</span>
                <span className="text-xs text-slate-500">{artifact.is_current ? 'Current' : artifact.status || 'Previous'}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
