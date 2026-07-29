import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  BookOpen,
  ChevronDown,
  FileQuestion,
  FlaskConical,
  Gamepad2,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
} from 'lucide-react'

import { GenerationAttachments } from '../components/generation/GenerationAttachments'
import { GenerationRunView } from '../components/generation/GenerationRunView'
import Toast from '../components/ui/Toast'
import type { Batch } from '../entity/Batch'
import { useBatchSelection } from '../hooks/useBatchSelection'
import { useGenerationRun } from '../hooks/useGenerationRun'
import { listArtifacts, type Artifact } from '../services/artifactService'
import { deleteGame, listGames, type GameSession } from '../services/gameService'
import type { ToastMessage } from '../types'
import { getErrorMessage } from '../utils/errors'
import { Spinner } from '../design-system'

// Saved work a game can be built from. Course plans are excluded: they are strategy, not
// the term-bearing teaching content a term/definition game needs.
const ARTIFACT_SOURCE_TYPES = ['lesson_plan', 'lab', 'quiz'] as const

function artifactIcon(type: string) {
  if (type === 'lab') return FlaskConical
  if (type === 'quiz' || type === 'assessment') return FileQuestion
  return BookOpen
}

function artifactTypeLabel(type: string): string {
  if (type === 'lab') return 'Lab'
  if (type === 'quiz' || type === 'assessment') return 'Assessment'
  return 'Lesson Plan'
}

function formatCreated(value?: string | null): string {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

/** Games retire on their own TTL, so the page warns before one disappears. */
function formatExpiry(value?: string | null): { text: string; expiring: boolean } {
  if (!value) return { text: '', expiring: false }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return { text: '', expiring: false }
  const days = Math.ceil((date.getTime() - Date.now()) / 86_400_000)
  if (days < 0) return { text: 'expired', expiring: true }
  if (days === 0) return { text: 'expires today', expiring: true }
  return { text: `expires in ${days} day${days === 1 ? '' : 's'}`, expiring: days <= 7 }
}

export default function Games() {
  const navigate = useNavigate()
  const { batches, loading: batchesLoading, selectedBatch, selectedBatchId, setSelectedBatchId } =
    useBatchSelection()

  const [games, setGames] = useState<GameSession[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [toast, setToast] = useState<ToastMessage | null>(null)

  const refresh = useCallback(async (batchId: string) => {
    setLoading(true)
    setError('')
    try {
      setGames(await listGames(batchId))
    } catch (err) {
      setError(getErrorMessage(err, 'Games could not be loaded.'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!selectedBatchId) {
      setGames([])
      return
    }
    setExpandedId(null)
    void refresh(selectedBatchId)
  }, [selectedBatchId, refresh])

  async function handleDelete(game: GameSession) {
    if (!selectedBatchId) return
    if (!window.confirm(`Delete "${game.title}"? This cannot be undone.`)) return
    setDeletingId(game.gameId)
    try {
      await deleteGame(selectedBatchId, game.gameId)
      setGames((prev) => prev.filter((entry) => entry.gameId !== game.gameId))
      setToast({ type: 'success', message: `Deleted "${game.title}".` })
    } catch (err) {
      setToast({ type: 'error', message: getErrorMessage(err, 'Could not delete that game.') })
    } finally {
      setDeletingId(null)
    }
  }

  const noBatches = !batchesLoading && batches.length === 0

  return (
    <div>
      <Toast toast={toast} onDismiss={() => setToast(null)} />

      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800 tracking-tight">Games</h1>
        <p className="text-sm text-slate-500 mt-1">
          Build a term/definition study game from a document you upload, or from a lesson plan,
          lab, or assessment you already saved.
        </p>
      </div>

      {noBatches ? (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <Gamepad2 className="mx-auto h-8 w-8 text-slate-300" />
          <p className="mt-3 text-sm text-slate-600">You need a space before you can make games.</p>
          <button
            type="button"
            onClick={() => navigate('/batches')}
            className="mt-4 inline-flex items-center rounded-md bg-violet-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-violet-700"
          >
            Create a space
          </button>
        </div>
      ) : (
        <>
          <div className="mb-5 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <label htmlFor="games-batch" className="mb-1.5 block text-sm font-semibold text-slate-700">
              Space (batch)
            </label>
            <select
              id="games-batch"
              value={selectedBatchId ?? ''}
              onChange={(event) => setSelectedBatchId(event.target.value)}
              disabled={batchesLoading}
              className="block w-full max-w-lg rounded-md border border-slate-300 px-2 py-2.5 text-sm focus:border-violet-500 focus:ring-violet-500"
            >
              {batches.map((batch) => (
                <option key={batch.id} value={batch.id}>
                  {batch.batch_name} — {batch.course_name}
                </option>
              ))}
            </select>
          </div>

          {selectedBatch && (
            <GameGenerator
              key={selectedBatch.id}
              batch={selectedBatch}
              onCreated={() => void refresh(selectedBatch.id)}
            />
          )}

          <div className="mb-3 mt-8 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-700">Games in this space</h2>
            <button
              type="button"
              onClick={() => selectedBatchId && void refresh(selectedBatchId)}
              disabled={loading || !selectedBatchId}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>

          {loading ? (
            <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white p-8 text-sm text-slate-500 shadow-sm">
              <Spinner size={16} />
              Loading games…
            </div>
          ) : error ? (
            <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">{error}</div>
          ) : games.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
              <Gamepad2 className="mx-auto h-8 w-8 text-slate-300" />
              <p className="mt-3 text-sm font-medium text-slate-700">No games in this space yet.</p>
              <p className="mt-1 text-sm text-slate-500">Use the panel above to build your first one.</p>
            </div>
          ) : (
            <ul className="space-y-3">
              {games.map((game) => {
                const expiry = formatExpiry(game.expiresAt)
                const created = formatCreated(game.createdAt)
                const expanded = expandedId === game.gameId
                return (
                  <li
                    key={game.gameId}
                    className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"
                  >
                    <div className="flex items-center gap-3 p-4">
                      <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-violet-100 text-violet-700">
                        <Gamepad2 className="h-5 w-5" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <h3 className="truncate text-base font-semibold text-slate-900">{game.title}</h3>
                        <p className="mt-0.5 text-xs text-slate-500">
                          {game.itemCount} pair{game.itemCount === 1 ? '' : 's'}
                          {created ? ` · created ${created}` : ''}
                          {expiry.text ? ' · ' : ''}
                          {expiry.text && (
                            <span className={expiry.expiring ? 'font-medium text-amber-600' : ''}>
                              {expiry.text}
                            </span>
                          )}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setExpandedId(expanded ? null : game.gameId)}
                        aria-expanded={expanded}
                        className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                      >
                        {expanded ? 'Hide' : 'View pairs'}
                        <ChevronDown className={`h-4 w-4 transition-transform ${expanded ? 'rotate-180' : ''}`} />
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDelete(game)}
                        disabled={deletingId === game.gameId}
                        className="flex-shrink-0 rounded-md p-2 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
                        aria-label={`Delete ${game.title}`}
                      >
                        {deletingId === game.gameId ? (
                          <Spinner size={16} />
                        ) : (
                          <Trash2 className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                    {expanded && (
                      <div className="border-t border-slate-100 bg-slate-50/60 px-4 py-3">
                        <ol className="space-y-2">
                          {game.items.map((item, index) => (
                            <li key={item.id || `${game.gameId}-${index}`} className="text-sm">
                              <span className="font-medium text-slate-800">{item.term}</span>
                              <span className="text-slate-400"> — </span>
                              <span className="text-slate-600">{item.definition}</span>
                            </li>
                          ))}
                        </ol>
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </>
      )}
    </div>
  )
}

/**
 * Source picker + generation run for one space. A game is built from exactly one source:
 * an uploaded document, or one saved artifact. The two choices are mutually exclusive —
 * picking a saved artifact clears any upload and vice versa — because the agent is told
 * to use a single source and mixing them produces a game that matches neither.
 */
function GameGenerator({ batch, onCreated }: { batch: Batch; onCreated: () => void }) {
  const run = useGenerationRun(batch, 'game')
  const [artifacts, setArtifacts] = useState<Artifact[]>([])
  const [artifactsLoading, setArtifactsLoading] = useState(false)
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(null)
  const [instructions, setInstructions] = useState('')

  const started = run.messages.length > 0 || Boolean(run.currentRunId)
  const uploads = run.pendingAttachments
  const selectedArtifact = artifacts.find((item) => item.id === selectedArtifactId) ?? null

  useEffect(() => {
    let cancelled = false
    setArtifactsLoading(true)
    listArtifacts(batch.id, { current: true })
      .then((data) => {
        if (cancelled) return
        setArtifacts(
          data.filter((item) =>
            ARTIFACT_SOURCE_TYPES.includes(
              String(item.type || item.artifact_type || '') as (typeof ARTIFACT_SOURCE_TYPES)[number],
            ),
          ),
        )
      })
      .catch(() => {
        if (!cancelled) setArtifacts([])
      })
      .finally(() => {
        if (!cancelled) setArtifactsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [batch.id])

  // One source only: choosing a saved artifact drops any uploaded file.
  function chooseArtifact(artifact: Artifact) {
    const next = selectedArtifactId === artifact.id ? null : artifact.id
    setSelectedArtifactId(next)
    if (next) uploads.forEach((item) => run.removePendingAttachment(item.attachment_id))
  }

  const hasSource = uploads.length > 0 || Boolean(selectedArtifact)

  async function handleGenerate() {
    if (run.sending || !hasSource) return
    const lines: string[] = []
    if (selectedArtifact) {
      const type = String(selectedArtifact.type || selectedArtifact.artifact_type || 'lesson_plan')
      const week = selectedArtifact.week
      lines.push(
        `Build a term/definition study game from the saved ${artifactTypeLabel(type).toLowerCase()}` +
          (week ? ` for Week ${week}` : '') +
          ` ("${selectedArtifact.title}"). Use get_artifact_content with artifact_type "${type}"` +
          (week ? ` and week ${week}.` : '.'),
      )
    } else {
      lines.push('Build a term/definition study game from the document attached to this message.')
    }
    if (instructions.trim()) lines.push(`Instructions: ${instructions.trim()}`)
    await run.generate({ workflowType: 'game', message: lines.join('\n'), webSearch: false })
  }

  if (started) {
    return (
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <h2 className="text-sm font-semibold text-slate-700">Game generation</h2>
          <button
            type="button"
            onClick={() => {
              run.reset()
              setSelectedArtifactId(null)
              onCreated()
            }}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            <Plus className="h-4 w-4" /> Build another
          </button>
        </div>
        <div className="max-h-[70vh] min-h-[20rem] overflow-y-auto">
          <GenerationRunView batch={batch} run={run} accent="primary" />
        </div>
      </section>
    )
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-sm font-semibold text-slate-700">Build a game</h2>
      <p className="mt-1 text-xs text-slate-500">Pick one source — an upload or saved work.</p>

      <div className="mt-4 grid gap-5 md:grid-cols-2">
        <div className={`rounded-lg border p-4 ${uploads.length > 0 ? 'border-violet-300 bg-violet-50/40' : 'border-slate-200'}`}>
          <h3 className="mb-2 text-sm font-semibold text-slate-800">Upload a document</h3>
          <p className="mb-3 text-xs text-slate-500">A PDF, slide deck, or notes file to extract terms from.</p>
          <GenerationAttachments run={run} />
        </div>

        <div className={`rounded-lg border p-4 ${selectedArtifact ? 'border-violet-300 bg-violet-50/40' : 'border-slate-200'}`}>
          <h3 className="mb-2 text-sm font-semibold text-slate-800">Or use saved work</h3>
          {artifactsLoading ? (
            <div className="flex items-center gap-2 py-3 text-xs text-slate-500">
              <Spinner size={14} />
              Loading saved work…
            </div>
          ) : artifacts.length === 0 ? (
            <p className="text-xs text-slate-500">
              Nothing saved in this space yet. Generate a lesson plan, lab, or assessment first.
            </p>
          ) : (
            <ul className="max-h-56 space-y-1.5 overflow-y-auto">
              {artifacts.map((artifact) => {
                const type = String(artifact.type || artifact.artifact_type || '')
                const Icon = artifactIcon(type)
                const active = selectedArtifactId === artifact.id
                return (
                  <li key={artifact.id}>
                    <button
                      type="button"
                      onClick={() => chooseArtifact(artifact)}
                      aria-pressed={active}
                      className={`flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors ${
                        active
                          ? 'border-violet-400 bg-white'
                          : 'border-transparent hover:border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      <Icon className="h-4 w-4 flex-shrink-0 text-violet-600" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-medium text-slate-800">
                          {artifact.title}
                        </span>
                        <span className="block text-[11px] text-slate-400">
                          {artifactTypeLabel(type)}
                          {artifact.week ? ` · Week ${artifact.week}` : ''}
                        </span>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>

      <div className="mt-4">
        <label htmlFor="game-instructions" className="mb-1.5 block text-sm font-semibold text-slate-700">
          Extra instructions (optional)
        </label>
        <input
          id="game-instructions"
          type="text"
          value={instructions}
          onChange={(event) => setInstructions(event.target.value)}
          placeholder="e.g. 12 pairs, focus on the key definitions students confuse"
          className="block w-full rounded-md border border-slate-300 px-3 py-2.5 text-sm focus:border-violet-500 focus:ring-violet-500"
        />
      </div>

      <div className="mt-4">
        <button
          type="button"
          onClick={() => void handleGenerate()}
          disabled={run.sending || !hasSource}
          className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-violet-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-violet-700 shadow-sm transition-colors disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none disabled:cursor-not-allowed"
        >
          {run.sending ? <Spinner tone="inverse" size={16} /> : <Sparkles className="h-4 w-4" />}
          Generate game
        </button>
        {!hasSource && !run.sending && (
          <p className="mt-2 text-center text-xs text-slate-500">
            Upload a document or pick saved work to continue.
          </p>
        )}
      </div>
    </section>
  )
}
