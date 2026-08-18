import { useMemo, useState } from 'react'
import { Copy, ExternalLink, RefreshCw, Trash2 } from 'lucide-react'
import type { Artifact, ArtifactSummary } from '../../../services/artifactService'
import { gamePlayUrl, type GameSession } from '../../../services/gameService'
import { GameRow } from '../../../components/games/GameRow'
import { SelectField } from '../../../components/ui/SelectField'
import { CHECKBOX_CLASS } from '../../../components/ui/fieldStyles'
import { artifactIcon } from '../../../utils/artifactIcons'
import { formatDateTime } from '../../../utils/formatDate'

type Props = {
  artifacts: Artifact[]
  /**
   * Games are not artifacts — they live in their own collection, with no
   * version chain, no week and no Drive file. They belong on this tab all the
   * same: to a lecturer, "generated content" plainly includes the game the
   * agent just made, and looking for it on a different page is a puzzle.
   */
  games: GameSession[]
  summary: ArtifactSummary | null
  loading: boolean
  onRefresh: () => void
  onDelete: (artifact: Artifact) => void
  onDeleteGame: (game: GameSession) => void
  batchId: string
  /** A deadline change or a close/reopen, applied in place. */
  onGameUpdated: (game: GameSession) => void
  onError: (message: string) => void
}

const TYPE_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'lesson_plan', label: 'Lesson Plans' },
  { value: 'lab', label: 'Labs' },
  { value: 'quiz', label: 'Assessments' },
  { value: 'game', label: 'Games' },
  { value: 'email', label: 'Emails' },
]

const SUMMARY_TYPES = [
  ['lesson_plan', 'Lesson Plans'],
  ['lab', 'Labs'],
  ['quiz', 'Assessments'],
  ['game', 'Games'],
] as const

function artifactTypeLabel(type: string) {
  return TYPE_OPTIONS.find((option) => option.value === type)?.label || type || 'Other'
}

/**
 * One row, whichever collection it came from.
 *
 * Artifacts and games share almost nothing structurally — the alternative was
 * a second list beneath the first, which puts the same question ("what has
 * this batch produced?") in two places and makes the type filter lie.
 */
type ContentRow = {
  key: string
  type: string
  title: string
  week?: number
  /** Undefined for a game: there is no version chain to number. */
  version?: number
  isCurrent: boolean
  status?: string
  createdAt?: string | null
  url: string
  studentUrl?: string
  /** The row's own extra fact — a game's size and deadline. */
  note?: string
  /** Present only on a game — the object `GameRow` needs. */
  game?: GameSession
  /** Absent for a game, which has no other versions to show. */
  versionsKey?: string
  onDelete: () => void
}

function gameNote(game: GameSession): string {
  const parts = [`${game.itemCount} pairs`]
  if (game.deadlineAt) {
    const due = new Date(game.deadlineAt)
    if (!Number.isNaN(due.getTime())) {
      parts.push(`due ${due.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`)
    }
  }
  return parts.join(' · ')
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

export function ArtifactsTab({
  artifacts,
  games,
  summary,
  loading,
  onRefresh,
  onDelete,
  onDeleteGame,
  batchId,
  onGameUpdated,
  onError,
}: Props) {
  const [typeFilter, setTypeFilter] = useState('')
  const [currentOnly, setCurrentOnly] = useState(false)
  const [weekFilter, setWeekFilter] = useState('')
  const [search, setSearch] = useState('')
  const [versionsKey, setVersionsKey] = useState<string | null>(null)
  const [expandedGameId, setExpandedGameId] = useState<string | null>(null)

  const weeks = useMemo(
    () =>
      Array.from(new Set(artifacts.map((artifact) => artifact.week).filter(Boolean) as number[]))
        .sort((a, b) => a - b),
    [artifacts],
  )

  // "All weeks" is the empty value, so it has to be an option rather than a
  // placeholder — the dropdown has to be able to get you back to it.
  const weekOptions = useMemo(
    () => [
      { value: '', label: 'All weeks' },
      ...weeks.map((week) => ({ value: String(week), label: `Week ${week}` })),
    ],
    [weeks],
  )

  const rows: ContentRow[] = useMemo(() => {
    const fromArtifacts = artifacts.map((artifact) => ({
      key: artifact.id,
      type: artifact.type,
      title: artifact.drive_file_name || artifact.title,
      week: artifact.week ?? undefined,
      version: artifact.version || 1,
      isCurrent: Boolean(artifact.is_current),
      status: artifact.status,
      createdAt: artifact.created_at,
      url: primaryUrl(artifact),
      studentUrl: metadataString(artifact, 'student_doc_url') || undefined,
      versionsKey: `${artifact.type}:${artifact.week ?? ''}`,
      onDelete: () => onDelete(artifact),
    }))

    const fromGames = games.map((game) => ({
      key: `game:${game.gameId}`,
      type: 'game',
      title: game.title,
      // No week and no version chain. `isCurrent` is true so "Current only"
      // does not silently hide every game — a game has no superseded twin.
      isCurrent: true,
      status: game.status,
      createdAt: game.createdAt,
      url: gamePlayUrl(game.gameId),
      note: gameNote(game),
      onDelete: () => onDeleteGame(game),
      /* The game itself rides along: a game row is not a flattened artifact,
         it is the same rich row the standalone Games page draws. */
      game,
    }))

    return [...fromArtifacts, ...fromGames].sort((a, b) => {
      const at = a.createdAt ? Date.parse(a.createdAt) : 0
      const bt = b.createdAt ? Date.parse(b.createdAt) : 0
      return bt - at
    })
  }, [artifacts, games, onDelete, onDeleteGame])

  const filtered = rows.filter((row) => {
    if (typeFilter && row.type !== typeFilter) return false
    if (currentOnly && !row.isCurrent) return false
    // A game has no week, so any week filter excludes it — which is right:
    // the lecturer asked for a specific week's material.
    if (weekFilter && String(row.week || '') !== weekFilter) return false
    const q = search.trim().toLowerCase()
    if (q && !(row.title || '').toLowerCase().includes(q)) return false
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
          // The artifact summary is computed server-side over the artifacts
          // collection, which games are not in — so theirs is counted here.
          const isGame = type === 'game'
          const count = summary?.counts?.[type] || { current: 0, total: 0 }
          const Icon = artifactIcon(type)
          return (
            <div key={type} className="rounded-lg border border-slate-200 bg-white px-4 py-3">
              <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
                <Icon className="h-3.5 w-3.5" />
                {label}
              </div>
              <div className="mt-1 text-2xl font-semibold text-slate-900">
                {isGame ? games.length : count.current}
              </div>
              <div className="text-xs text-slate-400">
                {isGame ? 'no versions kept' : `${count.total} total versions`}
              </div>
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
          <RefreshCw className="w-4 h-4" />
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <SelectField
          aria-label="Filter by type"
          value={typeFilter}
          onChange={setTypeFilter}
          options={TYPE_OPTIONS}
        />
        <SelectField
          aria-label="Filter by week"
          value={weekFilter}
          onChange={setWeekFilter}
          options={weekOptions}
        />
        <label className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2.5 text-sm font-medium text-slate-800 shadow-sm">
          <input type="checkbox" checked={currentOnly} onChange={(e) => setCurrentOnly(e.target.checked)} className={CHECKBOX_CLASS} />
          Current only
        </label>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search title"
          className="rounded-md border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 shadow-sm focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
        />
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        {loading ? (
          <div className="p-8 text-center text-sm text-slate-500">Loading generated content...</div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">Nothing generated for this batch yet.</div>
        ) : (
          <div className="divide-y divide-slate-100">
            {filtered.map((row) => {
              if (row.game) {
                return (
                  <div key={row.key}>
                    <GameRow
                      batchId={batchId}
                      game={row.game}
                      expanded={expandedGameId === row.game.gameId}
                      onToggleExpanded={() =>
                        setExpandedGameId(
                          expandedGameId === row.game!.gameId ? null : row.game!.gameId,
                        )
                      }
                      onUpdated={onGameUpdated}
                      onDelete={row.onDelete}
                      onError={onError}
                    />
                  </div>
                )
              }
              const Icon = artifactIcon(row.type)
              return (
                <div key={row.key} className="grid grid-cols-1 xl:grid-cols-[1fr_auto] gap-3 p-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      {/* The type's own icon, from the shared table, rather than
                          a FileText on every row — a game is not a document. */}
                      <span className="inline-flex items-center gap-1 rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                        <Icon className="w-3 h-3" />
                        {artifactTypeLabel(row.type)}
                      </span>
                      {row.week && <span className="text-xs text-slate-500">Week {row.week}</span>}
                      {row.version !== undefined && (
                        <span className="text-xs text-slate-500">v{String(row.version).padStart(2, '0')}</span>
                      )}
                      {row.note && <span className="text-xs text-slate-500">{row.note}</span>}
                      {row.isCurrent && row.version !== undefined && (
                        <span className="rounded bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-700">Current</span>
                      )}
                      {row.status && !row.isCurrent && (
                        <span className="rounded bg-slate-50 px-2 py-0.5 text-xs text-slate-500">{row.status}</span>
                      )}
                    </div>
                    <div className="mt-1 truncate text-sm font-semibold text-slate-900" title={row.title}>
                      {row.title}
                    </div>
                    {row.createdAt && (
                      <div className="mt-1 text-xs text-slate-400">{formatDateTime(row.createdAt)}</div>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 xl:justify-end">
                    {row.url && <a href={row.url} target="_blank" rel="noreferrer" className="text-sm font-medium text-violet-700 hover:underline">Open</a>}
                    {row.studentUrl && <a href={row.studentUrl} target="_blank" rel="noreferrer" className="text-sm font-medium text-violet-700 hover:underline">Student</a>}
                    {row.url && <button type="button" onClick={() => copyLink(row.url)} className="p-1.5 text-slate-500 hover:text-slate-800" title="Copy link"><Copy className="w-4 h-4" /></button>}
                    {row.versionsKey && (
                      <button type="button" onClick={() => setVersionsKey(row.versionsKey!)} className="text-sm text-slate-600 hover:text-slate-900">Versions</button>
                    )}
                    <button type="button" onClick={row.onDelete} className="p-1.5 text-slate-400 hover:text-red-600" title="Delete"><Trash2 className="w-4 h-4" /></button>
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
