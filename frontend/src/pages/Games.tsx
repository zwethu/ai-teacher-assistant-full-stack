import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  BookOpen,
  CalendarClock,
  Check,
  ChevronDown,
  Copy,
  Download,
  ExternalLink,
  Gamepad2,
  Lock,
  LockOpen,
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
import { gameTimeLimitMinutes } from '../lib/gameTiming'
import { deriveGenerationStage, isWorkflowSettled } from '../components/generation/generationStage'
import { artifactIcon } from '../utils/artifactIcons'
import {
  deleteGame,
  downloadGameResults,
  gamePlayUrl,
  listGames,
  updateGame,
  type GameSession,
} from '../services/gameService'
import type { ToastMessage } from '../types'
import { getErrorMessage } from '../utils/errors'
import { Button, Modal, Spinner } from '../design-system'

// Saved work a game can be built from. Course plans are excluded: they are strategy, not
// the term-bearing teaching content a term/definition game needs.
const ARTIFACT_SOURCE_TYPES = ['lesson_plan', 'lab', 'quiz'] as const

// Mirrors MIN_GAME_ITEMS / MAX_GAME_ITEMS in backend/entity/GameSession.py — the
// backend re-validates, so asking for a count outside these fails the create.
const MIN_PAIRS = 4
const MAX_PAIRS = 40
const DEFAULT_PAIRS = 30

/**
 * `datetime-local` speaks local wall-clock with no zone, so its value has to be built
 * from local parts — `toISOString()` here would shift the clock by the UTC offset.
 */
function toLocalInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  )
}

/** The lecturer's due date, as students experience it. */
function formatDeadline(value?: string | null): { text: string; passed: boolean } | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  const text = date.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  })
  return { text, passed: date.getTime() <= Date.now() }
}

/**
 * The chosen deadline has to outlive the component that collected it.
 *
 * The run view tells the lecturer, in as many words, that they can leave the
 * page and generation keeps running. Taking it at its word used to unmount the
 * generator and drop the deadline on the floor, so the game was created with no
 * due date — silently, right after the app said it was safe to go. Session
 * storage is the right lifetime: one in-flight generation per space, gone when
 * the tab closes.
 */
const deadlineKey = (batchId: string) => `mila:game-deadline:${batchId}`

function readStoredDeadline(batchId: string): string {
  try {
    return sessionStorage.getItem(deadlineKey(batchId)) ?? ''
  } catch {
    // Storage can be blocked outright (privacy mode, locked-down browser). A
    // missing deadline is recoverable; a crashed form is not.
    return ''
  }
}

function writeStoredDeadline(batchId: string, value: string): void {
  try {
    if (value) sessionStorage.setItem(deadlineKey(batchId), value)
    else sessionStorage.removeItem(deadlineKey(batchId))
  } catch {
    /* see above */
  }
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

// A game's `expiresAt` is a data-retention marker, not a teaching date, and nothing
// currently acts on it. Showing it alongside the deadline only raised the question of
// which date students are actually held to, so the deadline is the one date on screen.

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

      {/* One line, about the page. How the builder works is the builder's job to
          say — stating it here too meant the same sentence three times before a
          lecturer reached a single field. */}
      <div className="mb-6 max-w-xl">
        <h1 className="text-2xl font-bold text-slate-800 tracking-tight">Games</h1>
        <p className="text-sm text-slate-600 mt-1">
          Term/definition study games your students open from a link.
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
          {selectedBatch && (
            <GameGenerator
              key={selectedBatch.id}
              batch={selectedBatch}
              batches={batches}
              batchesLoading={batchesLoading}
              onSelectBatch={setSelectedBatchId}
              onCreated={() => void refresh(selectedBatch.id)}
            />
          )}

          <div className="mb-3 mt-8 flex items-center justify-between">
            {/* Names the space rather than saying "this space". The control that
                sets it now lives inside the builder, so the list has to say what
                it is showing on its own. */}
            <h2 className="text-sm font-semibold text-slate-700">
              Games in {selectedBatch?.batch_name ?? 'this space'}
            </h2>
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
                const created = formatCreated(game.createdAt)
                const expanded = expandedId === game.gameId
                return (
                  <li
                    key={game.gameId}
                    className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"
                  >
                    {/* One row, two bands: what the game IS (with the actions a
                        lecturer actually takes on it), then when students can
                        play it. The pair list is a rare review step, not a
                        headline action, so it hangs off the count instead of
                        owning a button of its own. */}
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 p-4">
                      <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-violet-100 text-violet-700">
                        <Gamepad2 className="h-5 w-5" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <h3 className="truncate text-base font-semibold text-slate-900">
                            {game.title}
                          </h3>
                          {game.status === 'closed' && (
                            <span className="flex-shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                              Closed
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 text-xs text-slate-500">
                          <button
                            type="button"
                            onClick={() => setExpandedId(expanded ? null : game.gameId)}
                            aria-expanded={expanded}
                            className="inline-flex items-center gap-1 rounded font-medium text-slate-600 underline decoration-slate-300 underline-offset-2 hover:text-violet-700 hover:decoration-violet-400"
                          >
                            {game.itemCount} pair{game.itemCount === 1 ? '' : 's'}
                            <ChevronDown
                              className={`h-3 w-3 transition-transform ${expanded ? 'rotate-180' : ''}`}
                            />
                          </button>
                          {created ? ` · created ${created}` : ''}
                        </p>
                      </div>
                      <GameResultsButton
                        batchId={selectedBatchId ?? ''}
                        game={game}
                        onError={(message) => setToast({ type: 'error', message })}
                      />
                      <GamePlayLink gameId={game.gameId} />
                      <button
                        type="button"
                        onClick={() => void handleDelete(game)}
                        disabled={deletingId === game.gameId}
                        // slate-400 measured 2.63:1 on white — under the 3:1 floor
                        // for a graphical control. slate-500 clears it at 4.76:1
                        // and still reads as recessive next to the link buttons.
                        className="flex-shrink-0 rounded-md p-2 text-slate-500 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
                        aria-label={`Delete ${game.title}`}
                      >
                        {deletingId === game.gameId ? (
                          <Spinner size={16} />
                        ) : (
                          <Trash2 className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                    <GameSchedule
                      batchId={selectedBatchId ?? ''}
                      game={game}
                      onUpdated={(updated) =>
                        setGames((prev) =>
                          prev.map((entry) =>
                            entry.gameId === updated.gameId ? updated : entry,
                          ),
                        )
                      }
                      onError={(message) => setToast({ type: 'error', message })}
                    />
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
 * Deadline and open/closed state for one live game. Both are lecturer decisions that
 * outlive the generator form — a due date gets extended, a game gets closed early —
 * so they are editable here rather than only at creation.
 */
function GameSchedule({
  batchId,
  game,
  onUpdated,
  onError,
}: {
  batchId: string
  game: GameSession
  onUpdated: (game: GameSession) => void
  onError: (message: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')
  const [saving, setSaving] = useState(false)

  const deadline = formatDeadline(game.deadlineAt)
  const closed = game.status === 'closed'
  const editDate = value ? new Date(value) : null
  const editValid = editDate !== null && !Number.isNaN(editDate.getTime()) && editDate > new Date()

  async function apply(changes: Parameters<typeof updateGame>[2]) {
    setSaving(true)
    try {
      onUpdated(await updateGame(batchId, game.gameId, changes))
      setEditing(false)
    } catch (err) {
      onError(getErrorMessage(err, 'Could not update that game.'))
    } finally {
      setSaving(false)
    }
  }

  function startEdit() {
    setValue(
      toLocalInputValue(
        game.deadlineAt ? new Date(game.deadlineAt) : new Date(Date.now() + 7 * 86_400_000),
      ),
    )
    setEditing(true)
  }

  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 px-4 py-2.5 text-xs">
      <CalendarClock className="h-3.5 w-3.5 flex-shrink-0 text-slate-400" />

      {editing ? (
        <>
          <input
            type="datetime-local"
            value={value}
            min={toLocalInputValue(new Date())}
            onChange={(event) => setValue(event.target.value)}
            aria-label={`Deadline for ${game.title}`}
            className="rounded-md border border-slate-300 px-2 py-1 text-xs focus:border-violet-500 focus:ring-violet-500"
          />
          <button
            type="button"
            onClick={() => void apply({ deadlineAt: editDate?.toISOString() })}
            disabled={!editValid || saving}
            className="rounded-md bg-violet-600 px-2.5 py-1 font-medium text-white hover:bg-violet-700 disabled:bg-slate-200 disabled:text-slate-400"
          >
            Save
          </button>
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="rounded-md px-2 py-1 font-medium text-slate-500 hover:text-slate-700"
          >
            Cancel
          </button>
        </>
      ) : (
        <>
          <span className={deadline?.passed ? 'font-medium text-amber-600' : 'text-slate-500'}>
            {deadline ? `Due ${deadline.text}${deadline.passed ? ' · passed' : ''}` : 'No deadline'}
          </span>
          <button
            type="button"
            onClick={startEdit}
            className="font-medium text-violet-600 hover:text-violet-700"
          >
            {deadline ? 'Change' : 'Set deadline'}
          </button>
          {deadline && (
            <button
              type="button"
              onClick={() => void apply({ clearDeadline: true })}
              disabled={saving}
              className="font-medium text-slate-400 hover:text-slate-600 disabled:opacity-50"
            >
              Remove
            </button>
          )}
        </>
      )}

      <button
        type="button"
        onClick={() => void apply({ status: closed ? 'open' : 'closed' })}
        disabled={saving}
        className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-1 font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
      >
        {closed ? <LockOpen className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
        {closed ? 'Reopen' : 'Close now'}
      </button>
    </div>
  )
}

/**
 * Results download for one game. The lecturer's question after the link goes out
 * is "who played, and how did they do" — until now the page could not answer it.
 */
function GameResultsButton({
  batchId,
  game,
  onError,
}: {
  batchId: string
  game: GameSession
  onError: (message: string) => void
}) {
  const [downloading, setDownloading] = useState(false)

  async function handleDownload() {
    setDownloading(true)
    try {
      await downloadGameResults(batchId, game.gameId)
    } catch (err) {
      onError(getErrorMessage(err, 'Could not export results for that game.'))
    } finally {
      setDownloading(false)
    }
  }

  return (
    <button
      type="button"
      onClick={() => void handleDownload()}
      disabled={downloading || !batchId}
      title="Download results as CSV"
      className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
    >
      {downloading ? <Spinner size={16} /> : <Download className="h-4 w-4" />}
      Results
    </button>
  )
}

/**
 * The student-facing link for a game — the game's equivalent of a Google Docs URL.
 *
 * It used to be a full-width strip of its own carrying the raw URL in a `<code>`
 * tag. Nobody transcribes a URL by eye: the two things a lecturer does with it are
 * hand it to students (copy) and check it themselves (open), so those are the two
 * controls and the address itself is gone.
 */
function GamePlayLink({ gameId }: { gameId: string }) {
  const url = gamePlayUrl(gameId)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 2000)
    return () => window.clearTimeout(timer)
  }, [copied])

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
    } catch {
      // Clipboard can be blocked (insecure origin, denied permission); the link
      // is on screen and selectable, so there is nothing to recover from.
    }
  }

  return (
    <div className="flex flex-shrink-0 items-center gap-2">
      <button
        type="button"
        onClick={() => void handleCopy()}
        className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
      >
        {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
        {copied ? 'Copied' : 'Copy link'}
      </button>
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
      >
        <ExternalLink className="h-4 w-4" /> Open game
      </a>
    </div>
  )
}

/**
 * Choosing among a term's saved work — a dialog, not a panel on the form.
 *
 * On the form this was a 224px scroll window showing about four rows. A 14-week
 * course with lesson plans, labs and assessments can put 40+ items behind that
 * porthole, unsorted and unsearchable. A dialog has the room, and it keeps the
 * form itself asking one question: what is this game built from?
 */
function SavedWorkPicker({
  open,
  onClose,
  artifacts,
  matches,
  query,
  onQueryChange,
  selectedId,
  onChoose,
}: {
  open: boolean
  onClose: () => void
  artifacts: Artifact[]
  matches: Artifact[]
  query: string
  onQueryChange: (value: string) => void
  selectedId: string | null
  onChoose: (artifact: Artifact) => void
}) {
  if (!open) return null

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Use saved work"
      eyebrow="Choose a source"
      size="md"
      footer={
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancel
        </Button>
      }
    >
      {artifacts.length === 0 ? (
        <p className="py-2 text-sm text-slate-600">
          Nothing saved in this space yet. Generate a lesson plan, lab, or assessment first, then
          come back and build a game from it.
        </p>
      ) : (
        <div className="space-y-3">
          {/* Only worth the row once the list outgrows a glance. */}
          {artifacts.length > 6 && (
            <input
              type="search"
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder="Search by title, type, or week"
              aria-label="Search saved work"
              className="block w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500"
            />
          )}

          {matches.length === 0 ? (
            <p className="py-2 text-sm text-slate-600">Nothing matches “{query}”.</p>
          ) : (
            // Single-choice, so it announces as one: a radiogroup rather than N
            // independent toggles. Choosing closes the dialog — there is nothing
            // left to confirm once the pick is made.
            <ul
              className="max-h-80 space-y-1.5 overflow-y-auto"
              role="radiogroup"
              aria-label="Saved work in this space"
            >
              {matches.map((artifact, index) => {
                const type = String(artifact.type || artifact.artifact_type || '')
                const Icon = artifactIcon(type)
                const active = selectedId === artifact.id
                return (
                  <li key={artifact.id}>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={active}
                      tabIndex={active || (!selectedId && index === 0) ? 0 : -1}
                      autoFocus={active || (!selectedId && index === 0)}
                      onClick={() => onChoose(artifact)}
                      onKeyDown={(event) => {
                        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
                        event.preventDefault()
                        const step = event.key === 'ArrowDown' ? 1 : -1
                        const nextIndex = (index + step + matches.length) % matches.length
                        const list = event.currentTarget.closest('ul')
                        list?.querySelectorAll('button')[nextIndex]?.focus()
                      }}
                      className={`flex w-full items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-1 ${
                        active
                          ? 'border-violet-500 bg-violet-50 ring-1 ring-violet-300'
                          : 'border-slate-200 hover:border-violet-300 hover:bg-violet-50/40'
                      }`}
                    >
                      <span
                        aria-hidden="true"
                        className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border ${
                          active ? 'border-violet-600' : 'border-slate-300'
                        }`}
                      >
                        {active && <span className="h-2 w-2 rounded-full bg-violet-600" />}
                      </span>
                      <Icon className="h-4 w-4 flex-shrink-0 text-violet-600" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-slate-800">
                          {artifact.title}
                        </span>
                        <span className="block text-xs text-slate-600">
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
      )}
    </Modal>
  )
}

/**
 * Source picker + generation run for one space. A game is built from exactly one source:
 * an uploaded document, or one saved artifact. The two choices are mutually exclusive —
 * picking a saved artifact clears any upload and vice versa — because the agent is told
 * to use a single source and mixing them produces a game that matches neither.
 */
function GameGenerator({
  batch,
  batches,
  batchesLoading,
  onSelectBatch,
  onCreated,
}: {
  batch: Batch
  batches: Batch[]
  batchesLoading: boolean
  onSelectBatch: (id: string) => void
  onCreated: () => void
}) {
  const run = useGenerationRun(batch, 'game')
  const [artifacts, setArtifacts] = useState<Artifact[]>([])
  const [artifactsLoading, setArtifactsLoading] = useState(false)
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(null)
  // The saved-work picker is a dialog, not a panel on the form. Two reasons: the
  // form should ask for ONE source, not make the lecturer choose a mechanism
  // first; and a whole term's lesson plans, labs and assessments never fit a
  // 4-row window on a form — a dialog has room to list and filter them.
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerQuery, setPickerQuery] = useState('')
  const [instructions, setInstructions] = useState('')
  // Held as text so the field can be cleared while typing; validated before use.
  const [pairCount, setPairCount] = useState(String(DEFAULT_PAIRS))
  // Seeded from storage so returning mid-run restores the deadline the lecturer
  // already chose, instead of quietly creating the game without one.
  const [deadline, setDeadline] = useState(() => readStoredDeadline(batch.id))
  const [hasDeadline, setHasDeadline] = useState(() => Boolean(readStoredDeadline(batch.id)))

  useEffect(() => {
    writeStoredDeadline(batch.id, hasDeadline ? deadline : '')
  }, [batch.id, hasDeadline, deadline])

  const pairs = Number(pairCount)
  const pairsValid = Number.isInteger(pairs) && pairs >= MIN_PAIRS && pairs <= MAX_PAIRS

  const deadlineDate = hasDeadline && deadline ? new Date(deadline) : null
  const deadlineValid =
    !hasDeadline ||
    (deadlineDate !== null && !Number.isNaN(deadlineDate.getTime()) && deadlineDate > new Date())
  // The deadline is not part of the prompt — the agent writes pairs, the backend owns
  // when play stops — so it rides separately to the create call at the end of the run.
  const deadlineIso = deadlineValid && deadlineDate ? deadlineDate.toISOString() : null

  const started = run.messages.length > 0 || Boolean(run.currentRunId)
  const uploads = run.pendingAttachments
  const selectedArtifact = artifacts.find((item) => item.id === selectedArtifactId) ?? null

  useEffect(() => {
    let cancelled = false
    setArtifactsLoading(true)
    listArtifacts(batch.id, { current: true })
      .then((data) => {
        if (cancelled) return
        const usable = data.filter((item) =>
          ARTIFACT_SOURCE_TYPES.includes(
            String(item.type || item.artifact_type || '') as (typeof ARTIFACT_SOURCE_TYPES)[number],
          ),
        )
        setArtifacts(usable)
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

  // One source only, enforced from both ends: picking saved work drops any
  // upload, and attaching a file drops any pick. A pending upload still rides
  // along with the generate call even when it is off screen, so a leftover would
  // send the agent both sources — the mix this form exists to prevent.
  function chooseArtifact(artifact: Artifact) {
    setSelectedArtifactId(artifact.id)
    uploads.forEach((item) => run.removePendingAttachment(item.attachment_id))
    setPickerOpen(false)
    setPickerQuery('')
  }

  useEffect(() => {
    if (uploads.length > 0) setSelectedArtifactId(null)
  }, [uploads.length])

  const hasSource = uploads.length > 0 || Boolean(selectedArtifact)

  const pickerMatches = artifacts.filter((artifact) => {
    if (!pickerQuery.trim()) return true
    const type = String(artifact.type || artifact.artifact_type || '')
    const haystack = `${artifact.title} ${artifactTypeLabel(type)} ${artifact.week ? `week ${artifact.week}` : ''}`
    return haystack.toLowerCase().includes(pickerQuery.trim().toLowerCase())
  })

  async function handleGenerate() {
    if (run.sending || !hasSource || !pairsValid || !deadlineValid) return
    const lines: string[] = [`Create exactly ${pairs} term/definition pairs.`]
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
      // Same width as the form it replaces, so hitting Generate doesn't snap the
      // panel to a different size mid-flow.
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        {/* No heading: the "Games" page title already names this, and repeating
            it in smaller type says nothing the reader did not just read. */}
        <div className="flex items-center justify-end border-b border-slate-200 px-5 py-3">
          {isWorkflowSettled(deriveGenerationStage(run).stage) && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                run.reset()
                setSelectedArtifactId(null)
                setHasDeadline(false)
                setDeadline('')
                onCreated()
              }}
              leadingIcon={<Plus className="h-4 w-4" />}
            >
              Build another
            </Button>
          )}
        </div>
        <div className="max-h-[70vh] min-h-[20rem] overflow-y-auto">
          <GenerationRunView
            batch={batch}
            run={run}
            accent="primary"
            gameDeadlineAt={deadlineIso}
            // The list lives on this page; the create button lives four
            // components down. Without this the run could finish and the list
            // below would still insist the space was empty.
            onGameCreated={onCreated}
          />
        </div>
      </section>
    )
  }

  return (
    // Full width, matching the games list below it. Capping the card left the
    // page with three different right edges — the card, the list, and the page
    // header — which read as misalignment rather than rhythm. Individual
    // controls are capped instead, so a short value never sits in a 1000px box.
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <h2 className="text-sm font-semibold text-slate-700">Build a game</h2>

      {/* The space belongs at the top of the form, not floating in the page
          corner where it aligned with nothing. It is still scope for the whole
          page — the list below names the space it is showing for that reason. */}
      <div className="mt-4">
        <label htmlFor="games-batch" className="mb-1.5 block text-sm font-semibold text-slate-700">
          Space
        </label>
        <select
          id="games-batch"
          value={batch.id}
          onChange={(event) => onSelectBatch(event.target.value)}
          disabled={batchesLoading}
          className="block w-full max-w-md rounded-md border border-slate-300 bg-white px-3 py-2.5 pr-9 text-sm text-slate-700 focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500"
        >
          {batches.map((option) => (
            <option key={option.id} value={option.id}>
              {option.batch_name} — {option.course_name}
            </option>
          ))}
        </select>
      </div>

      {/* Settings next — they arrive with sensible defaults, so the lecturer
          reads rather than works. The one genuinely required input, the source,
          comes last and sits directly above the button that consumes it.
          Sections are separated by rules, not by more borders. */}
      <div className="mt-5 grid max-w-3xl gap-4 border-t border-slate-100 pt-5 sm:grid-cols-[8rem_1fr]">
        <div>
          <label htmlFor="game-pair-count" className="mb-1.5 block text-sm font-semibold text-slate-700">
            Number of pairs
          </label>
          <input
            id="game-pair-count"
            type="number"
            inputMode="numeric"
            min={MIN_PAIRS}
            max={MAX_PAIRS}
            value={pairCount}
            onChange={(event) => setPairCount(event.target.value)}
            aria-describedby="game-pair-count-hint"
            aria-invalid={!pairsValid}
            className={`block w-full rounded-md border px-3 py-2.5 text-sm focus:ring-violet-500 ${
              pairsValid ? 'border-slate-300 focus:border-violet-500' : 'border-red-300 focus:border-red-500'
            }`}
          />
          <p
            id="game-pair-count-hint"
            className={`mt-1 text-xs ${pairsValid ? 'text-slate-500' : 'text-red-600'}`}
          >
            {pairsValid
              ? `About ${gameTimeLimitMinutes(pairs)} min to play`
              : `Pick between ${MIN_PAIRS} and ${MAX_PAIRS}`}
          </p>
        </div>

        <div>
          <label htmlFor="game-instructions" className="mb-1.5 block text-sm font-semibold text-slate-700">
            Extra instructions (optional)
          </label>
          <input
            id="game-instructions"
            type="text"
            value={instructions}
            onChange={(event) => setInstructions(event.target.value)}
            placeholder="e.g. focus on the key definitions students confuse"
            className="block w-full rounded-md border border-slate-300 px-3 py-2.5 text-sm focus:border-violet-500 focus:ring-violet-500"
          />
        </div>
      </div>

      <div className="mt-5 border-t border-slate-100 pt-5">
        <label className="flex items-center gap-2.5">
          <input
            type="checkbox"
            checked={hasDeadline}
            onChange={(event) => {
              setHasDeadline(event.target.checked)
              // Default to a week out: something sensible to adjust beats an empty
              // field the lecturer has to fill from scratch.
              if (event.target.checked && !deadline) {
                setDeadline(toLocalInputValue(new Date(Date.now() + 7 * 86_400_000)))
              }
            }}
            className="h-4 w-4 rounded border-slate-300 text-violet-600 focus:ring-violet-500"
          />
          <span className="text-sm font-semibold text-slate-700">Set a deadline</span>
        </label>
        <p className="mt-1 text-xs text-slate-500">
          {hasDeadline
            ? 'Students cannot start the game after this time. You can extend it later.'
            : 'Without one, the game stays open until you close it.'}
        </p>

        {hasDeadline && (
          <div className="mt-3">
            <input
              id="game-deadline"
              type="datetime-local"
              value={deadline}
              min={toLocalInputValue(new Date())}
              onChange={(event) => setDeadline(event.target.value)}
              aria-label="Deadline"
              aria-invalid={!deadlineValid}
              className={`block w-full max-w-xs rounded-md border px-3 py-2.5 text-sm focus:ring-violet-500 ${
                deadlineValid ? 'border-slate-300 focus:border-violet-500' : 'border-red-300 focus:border-red-500'
              }`}
            />
            {!deadlineValid && (
              <p className="mt-1 text-xs text-red-600">Pick a date and time in the future.</p>
            )}
          </div>
        )}
      </div>

      {/* One slot, two ways to fill it. The earlier version asked the lecturer to
          pick a MECHANISM (upload tab vs saved-work tab) before picking a thing,
          which is a question about the software rather than about the teaching. */}
      <div className="mt-5 border-t border-slate-100 pt-5">
        <h3 className="text-sm font-semibold text-slate-700">Source</h3>
        {/* The two buttons below already say what the options are; spelling them
            out here as well was the third time this page made the same point. */}
        <p className="mt-1 text-xs text-slate-500">Where the terms come from. Pick one.</p>

        {selectedArtifact ? (
          <div className="mt-3 flex flex-wrap items-center gap-x-2.5 gap-y-2 rounded-lg border border-violet-300 bg-violet-50 px-3 py-2.5">
            {(() => {
              const type = String(selectedArtifact.type || selectedArtifact.artifact_type || '')
              const Icon = artifactIcon(type)
              return (
                <>
                  <Icon className="h-4 w-4 flex-shrink-0 text-violet-600" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-slate-800">
                      {selectedArtifact.title}
                    </span>
                    <span className="block text-xs text-slate-600">
                      {artifactTypeLabel(type)}
                      {selectedArtifact.week ? ` · Week ${selectedArtifact.week}` : ''}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => setPickerOpen(true)}
                    className="rounded-md px-2 py-1 text-xs font-medium text-violet-700 hover:bg-violet-100"
                  >
                    Change
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedArtifactId(null)}
                    className="rounded-md px-2 py-1 text-xs font-medium text-slate-600 hover:bg-violet-100"
                  >
                    Remove
                  </button>
                </>
              )
            })()}
          </div>
        ) : (
          <div className="mt-3">
            {/* The alternative rides inside the attach ROW rather than beside the
                whole component: file previews grow downward, so a sibling laid
                out next to them floats to the middle of a tall block.
                `label={null}` — the heading above already names this, and the
                component's default calls a required input "optional". */}
            <GenerationAttachments
              run={run}
              label={null}
              actions={
                <>
                  {/* Stays available with a file attached. Hiding it meant a
                      lecturer who attached the wrong thing had to work out that
                      removing it was the route to the other option; choosing
                      saved work simply replaces the upload. */}
                  <span className="text-xs text-slate-500">or</span>
                  <button
                    type="button"
                    onClick={() => setPickerOpen(true)}
                    disabled={artifactsLoading}
                    className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                  >
                    {artifactsLoading ? <Spinner size={16} /> : <BookOpen className="h-4 w-4" />}
                    Use saved work
                  </button>
                </>
              }
            />
          </div>
        )}
      </div>

      <SavedWorkPicker
        open={pickerOpen}
        onClose={() => {
          setPickerOpen(false)
          setPickerQuery('')
        }}
        artifacts={artifacts}
        matches={pickerMatches}
        query={pickerQuery}
        onQueryChange={setPickerQuery}
        selectedId={selectedArtifactId}
        onChoose={chooseArtifact}
      />

      {/* Full-bleed across the old 1180px column, the CTA read as a banner rather
          than a button. Right-aligned at the end of the form is where the eye
          finishes, with the blocking reason beside it instead of centred under. */}
      <div className="mt-5 flex flex-wrap items-center justify-end gap-x-4 gap-y-2 border-t border-slate-100 pt-5">
        {!hasSource && !run.sending && (
          <p className="mr-auto text-xs text-slate-500">
            Upload a document or pick saved work to continue.
          </p>
        )}
        <Button
          type="button"
          onClick={() => void handleGenerate()}
          disabled={run.sending || !hasSource || !pairsValid || !deadlineValid}
          loading={run.sending}
          leadingIcon={<Sparkles className="h-4 w-4" />}
        >
          Generate game
        </Button>
      </div>
    </section>
  )
}
