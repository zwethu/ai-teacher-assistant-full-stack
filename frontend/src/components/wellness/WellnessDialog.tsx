import { useCallback, useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, Moon, Wind } from 'lucide-react'

import { useStress } from '../../context/StressContext'
import {
  ACTION_LABELS,
  BREATHING_REDUCTION,
  getJournal,
  type DailyReport,
  type StressLevel,
} from '../../services/wellnessService'
import { Button, Modal, Spinner } from '../../design-system'
import { LEVEL_TEXT, levelWord } from './stressLevel'

/** YYYY-MM for a month `offset` months before now, in the user's clock. */
function monthKey(offset: number): string {
  const now = new Date()
  const d = new Date(now.getFullYear(), now.getMonth() - offset, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function monthTitle(key: string): string {
  const [year, month] = key.split('-').map(Number)
  if (!year || !month) return key
  return new Date(year, month - 1, 1).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  })
}

function dayTitle(date: string, inProgress: boolean): string {
  if (inProgress) return 'Today, so far'
  const [year, month, day] = date.split('-').map(Number)
  if (!year) return date
  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
  })
}

/**
 * One day, as a sentence a person would actually write about their own work.
 *
 * The counts are the day's shape; the grinding line is the part that matters,
 * and it is deliberately written without a verdict. "You kept working for two
 * hours after the meter maxed out" is a fact the lecturer can do something
 * with. "You should have stopped" is a thing they would close the dialog to
 * avoid reading twice.
 */
function ReportCard({ report }: { report: DailyReport }) {
  const counts = Object.entries(report.actions).filter(([, n]) => n > 0)

  return (
    <li
      className={`rounded-xl border p-3.5 ${
        report.in_progress
          ? 'border-violet-200 bg-violet-50/50'
          : 'border-slate-200 bg-white'
      }`}
    >
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-semibold text-slate-800">
          {dayTitle(report.date, report.in_progress)}
        </p>
        <p className="shrink-0 text-xs text-slate-500">
          peak {Math.round(report.peak_score)}
          <span className="text-slate-300"> · </span>
          <span className={LEVEL_TEXT[levelOf(report.peak_score)]}>
            {levelWord(levelOf(report.peak_score))}
          </span>
        </p>
      </div>

      {counts.length === 0 ? (
        <p className="mt-1.5 text-xs text-slate-500">A quiet day — nothing generated.</p>
      ) : (
        <ul className="mt-2 space-y-1">
          {counts.map(([action, count]) => (
            <li key={action} className="flex items-baseline gap-2 text-xs text-slate-600">
              <span className="font-semibold tabular-nums text-slate-800">{count}</span>
              <span>{ACTION_LABELS[action] ?? action}</span>
            </li>
          ))}
        </ul>
      )}

      {report.grind_actions > 0 && (
        /* The one line this whole feature exists to be able to write. */
        <p className="mt-2.5 flex items-start gap-1.5 rounded-lg bg-amber-50 px-2.5 py-2 text-xs text-amber-900">
          <Moon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" aria-hidden="true" />
          <span>
            {report.grind_actions} {report.grind_actions === 1 ? 'thing' : 'things'} done
            with the meter already maxed
            {report.grind_from ? `, from ${report.grind_from}` : ''}.
          </span>
        </p>
      )}

      {report.breathing_done && (
        <p className="mt-2 text-xs text-violet-700">Breathing exercise done.</p>
      )}
    </li>
  )
}

/** Band from a score — for past days, where only the number was stored. */
function levelOf(score: number): StressLevel {
  if (score >= 95) return 'max'
  if (score >= 75) return 'high'
  if (score >= 40) return 'medium'
  return 'low'
}

/**
 * The wellness hub, opened by clicking the meter.
 *
 * Two things live here and nothing else: the breathing exercise, and the
 * journal. The journal is read, never written — it is built from what the
 * lecturer actually did, so there is no mood to pick and no box to fill in at
 * the end of a day that already went badly.
 */
export default function WellnessDialog() {
  const { stress, wellnessOpen, closeWellness, openBreathing } = useStress()
  const [offset, setOffset] = useState(0)
  const [page, setPage] = useState<DailyReport[]>([])
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)

  const month = monthKey(offset)

  const load = useCallback(async () => {
    setLoading(true)
    setFailed(false)
    try {
      const data = await getJournal(month)
      setPage(data.entries)
    } catch (err) {
      console.error('Failed to load wellness journal:', err)
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }, [month])

  /* Reload on open and whenever the month changes. Opening is also what makes
     the server finalise any day that ended since the last look. */
  useEffect(() => {
    if (!wellnessOpen) return
    void load()
  }, [wellnessOpen, load])

  /* Every visit starts on this month; a dialog that reopens in April because
     that is where it was left is a small mystery every time. */
  useEffect(() => {
    if (!wellnessOpen) setOffset(0)
  }, [wellnessOpen])

  const level = stress?.level ?? 'low'
  const score = Math.round(stress?.stress_score ?? 0)

  return (
    <Modal
      open={wellnessOpen}
      onClose={closeWellness}
      title="Your stress meter"
      eyebrow={`${levelWord(level)} · ${score}/100`}
      size="md"
      footer={<Button variant="secondary" onClick={closeWellness}>Close</Button>}
    >
      <div data-stress-ui className="space-y-5">
        <section>
          <Button block onClick={openBreathing}>
            <Wind className="h-4 w-4" aria-hidden="true" />
            {stress?.breathing_used_today ? 'Breathe again' : 'Start breathing exercise'}
          </Button>
          <p className="mt-1.5 text-center text-[11px] text-slate-500">
            {stress?.breathing_used_today
              ? `Today’s −${BREATHING_REDUCTION} is used. Breathing still helps; the meter also drops 5 points for every hour away.`
              : `~40 seconds · lowers the meter by ${BREATHING_REDUCTION} points, once a day`}
          </p>
        </section>

        <section className="border-t border-slate-100 pt-4">
          <div className="mb-2.5 flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-800">Journal</h3>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setOffset((v) => v + 1)}
                className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                aria-label="Previous month"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="min-w-[7.5rem] text-center text-xs font-medium text-slate-600">
                {monthTitle(month)}
              </span>
              <button
                type="button"
                onClick={() => setOffset((v) => Math.max(0, v - 1))}
                disabled={offset === 0}
                className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30 disabled:hover:bg-transparent"
                aria-label="Next month"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>

          {loading ? (
            <div className="flex justify-center py-8">
              <Spinner size={22} />
            </div>
          ) : failed ? (
            <p className="py-6 text-center text-xs text-slate-500">
              Could not load your journal.{' '}
              <button type="button" onClick={() => void load()} className="font-semibold text-violet-700 hover:underline">
                Try again
              </button>
            </p>
          ) : page.length === 0 ? (
            <p className="py-6 text-center text-xs text-slate-500">
              Nothing recorded this month. Your days are written here on their own,
              from the work you do.
            </p>
          ) : (
            <ul className="max-h-72 space-y-2 overflow-y-auto pr-1">
              {page.map((report) => (
                <ReportCard key={report.date} report={report} />
              ))}
            </ul>
          )}
        </section>
      </div>
    </Modal>
  )
}
