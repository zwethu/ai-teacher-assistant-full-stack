import { useEffect, useMemo, useState, type FormEvent } from 'react'
import type { Wellness as WellnessEntry } from '../entity/Wellness'
import { getErrorMessage } from '../utils/errors'

import { BookOpen, Plus, Trash2, X } from 'lucide-react'
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  where,
} from 'firebase/firestore'
import { fromFirestore, toFirestore } from '../entity/Wellness'
import { db } from '../lib/firebase'
import { useAuth } from '../hooks/useAuth'
import {
  getMoodOption,
  getMoodStyle,
  MOOD_OPTIONS,
  MOOD_SELECT_OPTIONS,
} from '../utils/constants'
import { formatDate } from '../utils/formatDate'
import { Spinner, Button } from '../design-system'

const NOTES_PREVIEW_LEN = 140

function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

function formatEntryDate(entry: WellnessEntry) {
  return formatDate(entry?.date)
}

function truncateNotes(notes: string, max = NOTES_PREVIEW_LEN) {
  const text = (notes || '').trim()
  if (!text) return 'No notes'
  if (text.length <= max) return text
  return `${text.slice(0, max).trim()}…`
}

function buildMoodCounts(entries: WellnessEntry[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const m of MOOD_OPTIONS) {
    counts[m.value] = 0
  }
  for (const entry of entries) {
    const mood = MOOD_OPTIONS.some((m) => m.value === entry.mood)
      ? entry.mood
      : 'not_selected'
    counts[mood] = (counts[mood] || 0) + 1
  }
  return counts
}

const INITIAL_FORM = {
  mood: 'okay',
  notes: '',
  date: todayIso(),
}

export default function Wellness() {
  const { user } = useAuth()
  const [entries, setEntries] = useState<WellnessEntry[]>([])
  const [listLoading, setListLoading] = useState(true)
  const [addOpen, setAddOpen] = useState(false)
  const [form, setForm] = useState(INITIAL_FORM)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  useEffect(() => {
    if (!user?.uid) {
      setEntries([])
      setListLoading(false)
      return undefined
    }

    setListLoading(true)
    const q = query(
      collection(db, 'wellness'),
      where('uid', '==', user.uid),
      orderBy('date', 'desc'),
    )

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        setEntries(
          snapshot.docs.map((d) => fromFirestore(d)).filter((d): d is WellnessEntry => d !== null),
        )
        setListLoading(false)
      },
      (err) => {
        console.error('Failed to load wellness entries:', err)
        setListLoading(false)
      },
    )

    return unsubscribe
  }, [user?.uid])

  const moodCounts = useMemo(() => buildMoodCounts(entries), [entries])
  const totalEntries = entries.length
  const moodStats = useMemo(
    () =>
      MOOD_SELECT_OPTIONS.filter((m) => moodCounts[m.value] > 0).map((m) => ({
        mood: m.value,
        count: moodCounts[m.value],
        meta: m,
        style: getMoodStyle(m.value),
      })),
    [moodCounts],
  )

  const maxMoodCount = useMemo(
    () => Math.max(1, ...moodStats.map((s) => s.count)),
    [moodStats],
  )

  function openAddModal() {
    setForm({ mood: 'okay', notes: '', date: todayIso() })
    setFormError('')
    setAddOpen(true)
  }

  function closeAddModal() {
    if (saving) return
    setAddOpen(false)
    setFormError('')
  }

  async function handleAdd(e: FormEvent) {
    e.preventDefault()
    if (!user) return

    const mood = form.mood
    if (!mood || mood === 'not_selected') {
      setFormError('Please select how you are feeling.')
      return
    }

    setSaving(true)
    setFormError('')
    try {
      await addDoc(
        collection(db, 'wellness'),
        toFirestore({
          uid: user.uid,
          mood,
          notes: form.notes.trim(),
          date: form.date,
          createdAt: serverTimestamp(),
        }),
      )
      closeAddModal()
    } catch (err) {
      console.error(err)
      setFormError(getErrorMessage(err, 'Failed to save entry.'))
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(item: WellnessEntry) {
    if (!item.id) return
    const meta = getMoodOption(item.mood)
    if (
      !window.confirm(
        `Delete this ${meta.label.toLowerCase()} journal entry from ${formatEntryDate(item)}?`,
      )
    ) {
      return
    }

    try {
      await deleteDoc(doc(db, 'wellness', item.id))
    } catch (err) {
      console.error(err)
      window.alert('Failed to delete entry.')
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 tracking-tight">
            Wellness Journal
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Private reflection check-ins from stressful moments.
          </p>
        </div>
        <Button type="button" onClick={openAddModal} className="focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-violet-500">
          <Plus className="w-5 h-5 mr-2 -ml-1" />
          Add Entry
        </Button>
      </div>

      {/* Mood stats */}
      {!listLoading && totalEntries > 0 && (
        <div className="mb-6 rounded-2xl border border-slate-100 bg-white shadow-sm p-5">
          <h2 className="text-sm font-semibold text-slate-700 mb-3">
            Mood summary
          </h2>
          <div className="flex flex-wrap gap-2 mb-4">
            {moodStats.map(({ mood, count, meta, style }) => (
              <span
                key={mood}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium border ${style.pill}`}
              >
                <span aria-hidden="true">{meta.emoji}</span>
                {meta.label} ({count})
              </span>
            ))}
          </div>
          <div className="space-y-2">
            {moodStats.map(({ mood, count, meta }) => (
              <div key={`bar-${mood}`} className="flex items-center gap-3">
                <span className="w-28 text-xs font-medium text-slate-600 shrink-0">
                  {meta.emoji} {meta.label}
                </span>
                <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${
                      mood === 'great'
                        ? 'bg-violet-400'
                        : mood === 'okay'
                          ? 'bg-sky-400'
                          : mood === 'tired'
                            ? 'bg-amber-400'
                            : mood === 'stressed'
                              ? 'bg-orange-400'
                              : 'bg-red-400'
                    }`}
                    style={{ width: `${(count / maxMoodCount) * 100}%` }}
                  />
                </div>
                <span className="text-xs text-slate-500 w-6 text-right">{count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="relative rounded-2xl border border-slate-100 bg-white shadow-sm overflow-hidden">
        {listLoading ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <Spinner size={32} />
            <p className="text-sm text-slate-500">Loading journal entries…</p>
          </div>
        ) : entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center px-6">
            <div className="h-16 w-16 bg-slate-50 rounded-full flex items-center justify-center mb-4">
              <BookOpen className="w-8 h-8 text-slate-300" />
            </div>
            <h3 className="text-sm font-medium text-slate-900">
              No entries yet. Start tracking your wellness today!
            </h3>
            <p className="mt-1 text-sm text-slate-500 mb-6 max-w-sm">
              Log how you are feeling and capture notes from your teaching week.
            </p>
            <Button type="button" onClick={openAddModal}>
              <Plus className="w-4 h-4 mr-2" />
              Add Entry
            </Button>
          </div>
        ) : (
          <div className="p-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {entries.map((item) => {
              const meta = getMoodOption(item.mood)
              const style = getMoodStyle(item.mood)
              return (
                <article
                  key={item.id}
                  className={`rounded-xl border p-5 shadow-sm transition-all hover:shadow-md ${style.card}`}
                >
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <span
                        className="text-2xl flex-shrink-0"
                        role="img"
                        aria-label={meta.label}
                      >
                        {meta.emoji}
                      </span>
                      <div className="min-w-0">
                        <h3 className={`font-semibold ${style.text}`}>
                          {meta.label}
                        </h3>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {formatEntryDate(item)}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleDelete(item)}
                      className="inline-flex items-center justify-center p-1.5 rounded-md border border-slate-200 bg-white text-slate-500 hover:text-red-600 hover:border-red-200 hover:bg-red-50 transition-colors shrink-0"
                      aria-label="Delete entry"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                  <p className="text-sm text-slate-700 leading-relaxed line-clamp-4">
                    {truncateNotes(item.notes)}
                  </p>
                </article>
              )
            })}
          </div>
        )}
      </div>

      {addOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            onClick={closeAddModal}
            aria-hidden="true"
          />
          <div className="relative w-full max-w-md rounded-xl bg-white shadow-2xl border border-slate-200 overflow-hidden">
            <div className="bg-slate-50 px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-slate-800">Add Entry</h3>
              <button
                type="button"
                onClick={closeAddModal}
                disabled={saving}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-md hover:bg-slate-200"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleAdd} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                  Mood
                </label>
                <select
                  required
                  value={form.mood}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, mood: e.target.value }))
                  }
                  className="block w-full rounded-md border border-slate-300 shadow-sm py-2.5 px-3 text-sm focus:border-violet-500 focus:ring-violet-500"
                >
                  {MOOD_SELECT_OPTIONS.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.emoji} {m.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                  Date
                </label>
                <input
                  type="date"
                  required
                  value={form.date}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, date: e.target.value }))
                  }
                  className="block w-full rounded-md border border-slate-300 shadow-sm py-2.5 px-3 text-sm focus:border-violet-500 focus:ring-violet-500"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                  Notes
                </label>
                <textarea
                  rows={4}
                  value={form.notes}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, notes: e.target.value }))
                  }
                  placeholder="What happened today? How are you feeling?"
                  className="block w-full rounded-md border border-slate-300 shadow-sm py-2.5 px-3 text-sm focus:border-violet-500 focus:ring-violet-500"
                />
              </div>

              {formError && (
                <p className="text-sm text-red-600 font-medium">{formError}</p>
              )}

              <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={closeAddModal}
                  disabled={saving}
                  className="px-4 py-2 text-sm font-medium rounded-md border border-slate-300 text-slate-700 bg-white hover:bg-slate-50 disabled:opacity-60"
                >
                  Cancel
                </button>
                <Button type="submit" disabled={saving} className="min-w-[100px]">
                  {saving ? (
                    <>
                      <Spinner tone="inverse" size={16} />
                      Saving…
                    </>
                  ) : (
                    'Save Entry'
                  )}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
