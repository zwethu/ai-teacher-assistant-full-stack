import { useEffect, useState } from 'react'
import {
  CalendarClock,
  Check,
  ChevronDown,
  Copy,
  Download,
  ExternalLink,
  Gamepad2,
  Lock,
  LockOpen,
  Trash2,
} from 'lucide-react'

import { DateField } from '../ui/DateField'
import {
  downloadGameResults,
  gamePlayUrl,
  updateGame,
  type GameSession,
} from '../../services/gameService'
import { getErrorMessage } from '../../utils/errors'
import { Spinner } from '../../design-system'

/**
 * One live game, with everything a lecturer does to it.
 *
 * Lifted out of the standalone Games page so the batch's Generated
 * content tab can show the same thing. That tab used to flatten a game into the
 * generic artifact row — a title, a type chip and the string "20 pairs" — which
 * dropped the results download, the play link, the pair list and the whole
 * deadline band. The same object was two different objects depending on which
 * page you found it from.
 */

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

function formatCreated(value?: string | null): string {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}


export function GameRow({
  batchId,
  game,
  expanded,
  onToggleExpanded,
  onUpdated,
  onDelete,
  onError,
}: {
  batchId: string
  game: GameSession
  expanded: boolean
  onToggleExpanded: () => void
  onUpdated: (game: GameSession) => void
  onDelete: () => void
  onError: (message: string) => void
}) {
  const created = formatCreated(game.createdAt)
  return (
    <>
      {/* One row, two bands: what the game IS (with the actions a lecturer
          actually takes on it), then when students can play it. The pair list
          is a rare review step, not a headline action, so it hangs off the
          count instead of owning a button of its own. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 p-4">
        <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-violet-100 text-violet-700">
          <Gamepad2 className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-base font-semibold text-slate-900">{game.title}</h3>
            {game.status === 'closed' && (
              <span className="flex-shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                Closed
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-slate-500">
            <button
              type="button"
              onClick={onToggleExpanded}
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
        <GameResultsButton batchId={batchId} game={game} onError={onError} />
        <GamePlayLink gameId={game.gameId} />
        <button
          type="button"
          onClick={onDelete}
          // slate-400 measured 2.63:1 on white — under the 3:1 floor for a
          // graphical control. slate-500 clears it at 4.76:1 and still reads as
          // recessive next to the link buttons.
          className="flex-shrink-0 rounded-md p-2 text-slate-500 transition-colors hover:bg-red-50 hover:text-red-600"
          aria-label={`Delete ${game.title}`}
        >
          {/* No in-place spinner: the row is gone on the click, and the request
              it is waiting for has not even been sent yet. */}
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
      <GameSchedule batchId={batchId} game={game} onUpdated={onUpdated} onError={onError} />
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
    </>
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
          <DateField
            withTime
            className="w-56"
            value={value}
            min={toLocalInputValue(new Date())}
            onChange={setValue}
            aria-label={`Deadline for ${game.title}`}
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
