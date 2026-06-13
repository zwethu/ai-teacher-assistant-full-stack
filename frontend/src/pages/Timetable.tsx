import { useEffect, useMemo, useState, type FormEvent } from 'react'
import type { Timetable as TimetableEntry } from '../entity/Timetable'
import { getErrorMessage } from '../utils/errors'

import { Calendar, Loader2, Plus, Trash2, X } from 'lucide-react'
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore'
import { fromFirestore, toFirestore } from '../entity/Timetable'
import { db } from '../lib/firebase'
import { useAuth } from '../hooks/useAuth'

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']
const PERIODS = Array.from({ length: 8 }, (_, i) => `Period ${i + 1}`)

const SUBJECT_PALETTES = [
  {
    cell: 'bg-blue-50 border-blue-200 hover:bg-blue-100/80',
    text: 'text-blue-900',
    sub: 'text-blue-700',
  },
  {
    cell: 'bg-emerald-50 border-emerald-200 hover:bg-emerald-100/80',
    text: 'text-emerald-900',
    sub: 'text-emerald-700',
  },
  {
    cell: 'bg-violet-50 border-violet-200 hover:bg-violet-100/80',
    text: 'text-violet-900',
    sub: 'text-violet-700',
  },
  {
    cell: 'bg-amber-50 border-amber-200 hover:bg-amber-100/80',
    text: 'text-amber-900',
    sub: 'text-amber-700',
  },
  {
    cell: 'bg-rose-50 border-rose-200 hover:bg-rose-100/80',
    text: 'text-rose-900',
    sub: 'text-rose-700',
  },
  {
    cell: 'bg-cyan-50 border-cyan-200 hover:bg-cyan-100/80',
    text: 'text-cyan-900',
    sub: 'text-cyan-700',
  },
  {
    cell: 'bg-indigo-50 border-indigo-200 hover:bg-indigo-100/80',
    text: 'text-indigo-900',
    sub: 'text-indigo-700',
  },
  {
    cell: 'bg-orange-50 border-orange-200 hover:bg-orange-100/80',
    text: 'text-orange-900',
    sub: 'text-orange-700',
  },
]

function subjectPalette(subject: string) {
  if (!subject) return SUBJECT_PALETTES[0]
  const hash = [...subject].reduce((acc, ch) => acc + ch.charCodeAt(0), 0)
  return SUBJECT_PALETTES[hash % SUBJECT_PALETTES.length]
}

function buildGrid(entries: TimetableEntry[]): Record<string, Record<string, TimetableEntry | null>> {
  const grid: Record<string, Record<string, TimetableEntry | null>> = {}
  for (const day of DAYS) {
    grid[day] = {}
    for (const period of PERIODS) {
      grid[day][period] = null
    }
  }
  for (const entry of entries) {
    if (DAYS.includes(entry.day) && PERIODS.includes(entry.period)) {
      grid[entry.day][entry.period] = entry
    }
  }
  return grid
}

const EMPTY_FORM = {
  day: '',
  period: '',
  subject: '',
  classroom: '',
  notes: '',
}

export default function Timetable() {
  const { user } = useAuth()
  const [entries, setEntries] = useState<TimetableEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [modalMode, setModalMode] = useState('add')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!user?.uid) {
      setEntries([])
      setLoading(false)
      return undefined
    }

    setLoading(true)
    const q = query(
      collection(db, 'timetable'),
      where('uid', '==', user.uid),
    )

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        setEntries(
          snapshot.docs.map((d) => fromFirestore(d)).filter((d): d is TimetableEntry => d !== null),
        )
        setLoading(false)
      },
      (err) => {
        console.error('Failed to load timetable:', err)
        setLoading(false)
        setError('Could not load timetable. Check Firestore rules.')
      },
    )

    return unsubscribe
  }, [user?.uid])

  const grid = useMemo(() => buildGrid(entries), [entries])
  const hasAnyEntry = entries.length > 0

  function openAdd(day: string, period: string) {
    setModalMode('add')
    setEditingId(null)
    setForm({
      day,
      period,
      subject: '',
      classroom: '',
      notes: '',
    })
    setError('')
    setModalOpen(true)
  }

  function openEdit(entry: TimetableEntry) {
    setModalMode('edit')
    setEditingId(entry.id)
    setForm({
      day: entry.day,
      period: entry.period,
      subject: entry.subject || '',
      classroom: entry.classroom || '',
      notes: entry.notes || '',
    })
    setError('')
    setModalOpen(true)
  }

  function closeModal() {
    if (saving) return
    setModalOpen(false)
    setEditingId(null)
    setForm(EMPTY_FORM)
    setError('')
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!user) return

    setSaving(true)
    setError('')

    const payload = {
      day: form.day,
      period: form.period,
      subject: form.subject.trim(),
      classroom: form.classroom.trim(),
      notes: form.notes.trim(),
    }

    try {
      if (modalMode === 'add') {
        await addDoc(
          collection(db, 'timetable'),
          toFirestore({
            uid: user.uid,
            ...payload,
            createdAt: serverTimestamp(),
          }),
        )
      } else if (editingId) {
        await updateDoc(doc(db, 'timetable', editingId), toFirestore(payload))
      }
      closeModal()
    } catch (err) {
      console.error(err)
      setError(getErrorMessage(err, 'Failed to save entry.'))
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!editingId) return
    if (!window.confirm('Delete this timetable entry?')) return

    setSaving(true)
    setError('')
    try {
      await deleteDoc(doc(db, 'timetable', editingId))
      closeModal()
    } catch (err) {
      console.error(err)
      setError(getErrorMessage(err, 'Failed to delete entry.'))
    } finally {
      setSaving(false)
    }
  }

  function renderCell(day: string, period: string) {
    const entry = grid[day][period]

    if (!entry) {
      return (
        <button
          type="button"
          onClick={() => openAdd(day, period)}
          className="w-full min-h-[72px] flex flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-slate-200 bg-slate-50/50 text-slate-400 hover:border-emerald-300 hover:bg-emerald-50/40 hover:text-emerald-600 transition-colors"
          aria-label={`Add class on ${day}, ${period}`}
        >
          <Plus className="w-5 h-5" />
          <span className="text-xs font-medium">Add</span>
        </button>
      )
    }

    const palette = subjectPalette(entry.subject)

    return (
      <button
        type="button"
        onClick={() => openEdit(entry)}
        className={`w-full min-h-[72px] text-left rounded-lg border px-3 py-2 transition-colors ${palette.cell}`}
      >
        <p className={`text-sm font-semibold truncate ${palette.text}`}>
          {entry.subject}
        </p>
        {entry.classroom && (
          <p className={`text-xs truncate mt-0.5 ${palette.sub}`}>
            {entry.classroom}
          </p>
        )}
      </button>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 tracking-tight">
            Timetable
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Plan your weekly teaching schedule by day and period.
          </p>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <Loader2 className="w-8 h-8 text-emerald-600 animate-spin" />
            <p className="text-sm text-slate-500">Loading timetable…</p>
          </div>
        ) : !hasAnyEntry ? (
          <div className="flex flex-col items-center justify-center py-16 text-center px-6">
            <div className="h-16 w-16 bg-slate-50 rounded-full flex items-center justify-center mb-4">
              <Calendar className="w-8 h-8 text-slate-300" />
            </div>
            <h3 className="text-sm font-medium text-slate-900">
              Your timetable is empty. Click any cell to add a class.
            </h3>
            <p className="mt-1 text-sm text-slate-500 max-w-md">
              Use the grid below to build your weekly schedule. Each cell is one
              period on a school day.
            </p>
          </div>
        ) : null}

        {!loading && (
          <>
        {/* Desktop / tablet grid */}
        <div
          className={`hidden md:block overflow-x-auto ${!hasAnyEntry ? 'pt-2 pb-6 px-4 sm:px-6' : 'p-4 sm:p-6'}`}
        >
          <table className="min-w-full border-collapse">
            <thead>
              <tr>
                <th className="w-28 px-3 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider bg-slate-50/90 rounded-tl-lg border border-slate-100">
                  Period
                </th>
                {DAYS.map((day) => (
                  <th
                    key={day}
                    className="px-3 py-3 text-center text-xs font-semibold text-slate-600 uppercase tracking-wider bg-slate-50/90 border border-slate-100 min-w-[120px]"
                  >
                    {day}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {PERIODS.map((period, rowIndex) => (
                <tr key={period}>
                  <td
                    className={`px-3 py-3 text-sm font-medium text-slate-700 whitespace-nowrap bg-slate-50/50 border border-slate-100 ${
                      rowIndex === PERIODS.length - 1 ? 'rounded-bl-lg' : ''
                    }`}
                  >
                    {period}
                  </td>
                  {DAYS.map((day) => (
                    <td
                      key={`${day}-${period}`}
                      className="p-2 border border-slate-100 align-top"
                    >
                      {renderCell(day, period)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Mobile list grouped by day */}
        <div
          className={`md:hidden divide-y divide-slate-100 ${!hasAnyEntry ? 'px-4 pb-6' : ''}`}
        >
          {DAYS.map((day) => (
            <section key={day} className="p-4">
              <h3 className="text-sm font-semibold text-slate-800 mb-3">{day}</h3>
              <div className="space-y-2">
                {PERIODS.map((period) => {
                  const entry = grid[day][period]

                  if (!entry) {
                    return (
                      <button
                        key={period}
                        type="button"
                        onClick={() => openAdd(day, period)}
                        className="w-full flex items-center justify-between gap-3 rounded-lg border border-dashed border-slate-200 bg-slate-50/50 px-4 py-3 text-left hover:border-emerald-300 hover:bg-emerald-50/40 transition-colors"
                      >
                        <span className="text-sm font-medium text-slate-600">
                          {period}
                        </span>
                        <span className="inline-flex items-center gap-1 text-xs text-slate-400">
                          <Plus className="w-4 h-4" />
                          Add
                        </span>
                      </button>
                    )
                  }

                  const palette = subjectPalette(entry.subject)

                  return (
                    <button
                      key={period}
                      type="button"
                      onClick={() => openEdit(entry)}
                      className={`w-full flex items-start justify-between gap-3 rounded-lg border px-4 py-3 text-left transition-colors ${palette.cell}`}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium text-slate-500">
                          {period}
                        </p>
                        <p className={`text-sm font-semibold truncate ${palette.text}`}>
                          {entry.subject}
                        </p>
                        {entry.classroom && (
                          <p className={`text-xs truncate ${palette.sub}`}>
                            {entry.classroom}
                          </p>
                        )}
                      </div>
                    </button>
                  )
                })}
              </div>
            </section>
          ))}
        </div>
          </>
        )}
      </div>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            onClick={closeModal}
            aria-hidden="true"
          />
          <div className="relative w-full max-w-md rounded-xl bg-white shadow-2xl border border-slate-200 overflow-hidden">
            <div className="bg-slate-50 px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-slate-800">
                {modalMode === 'add' ? 'Add Class' : 'Edit Class'}
              </h3>
              <button
                type="button"
                onClick={closeModal}
                disabled={saving}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-md hover:bg-slate-200"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                    Day
                  </label>
                  <input
                    type="text"
                    readOnly
                    value={form.day}
                    className="block w-full rounded-md border border-slate-200 bg-slate-50 py-2.5 px-3 text-sm text-slate-600"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                    Period
                  </label>
                  <input
                    type="text"
                    readOnly
                    value={form.period}
                    className="block w-full rounded-md border border-slate-200 bg-slate-50 py-2.5 px-3 text-sm text-slate-600"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                  Subject
                </label>
                <input
                  type="text"
                  required
                  value={form.subject}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, subject: e.target.value }))
                  }
                  placeholder="e.g. Mathematics"
                  className="block w-full rounded-md border border-slate-300 shadow-sm py-2.5 px-3 text-sm focus:border-emerald-500 focus:ring-emerald-500"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                  Classroom
                </label>
                <input
                  type="text"
                  required
                  value={form.classroom}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, classroom: e.target.value }))
                  }
                  placeholder="e.g. Room 204"
                  className="block w-full rounded-md border border-slate-300 shadow-sm py-2.5 px-3 text-sm focus:border-emerald-500 focus:ring-emerald-500"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                  Notes <span className="font-normal text-slate-400">(optional)</span>
                </label>
                <textarea
                  rows={3}
                  value={form.notes}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, notes: e.target.value }))
                  }
                  placeholder="e.g. Bring lab equipment"
                  className="block w-full rounded-md border border-slate-300 shadow-sm py-2.5 px-3 text-sm focus:border-emerald-500 focus:ring-emerald-500"
                />
              </div>

              {error && (
                <p className="text-sm text-red-600 font-medium">{error}</p>
              )}

              <div className="flex items-center justify-between gap-3 pt-2 border-t border-slate-100">
                {modalMode === 'edit' ? (
                  <button
                    type="button"
                    onClick={handleDelete}
                    disabled={saving}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-md border border-red-200 text-red-700 bg-white hover:bg-red-50 disabled:opacity-60"
                  >
                    <Trash2 className="w-4 h-4" />
                    Delete
                  </button>
                ) : (
                  <span />
                )}
                <div className="flex items-center gap-3 ml-auto">
                  <button
                    type="button"
                    onClick={closeModal}
                    disabled={saving}
                    className="px-4 py-2 text-sm font-medium rounded-md border border-slate-300 text-slate-700 bg-white hover:bg-slate-50 disabled:opacity-60"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium rounded-md text-white bg-emerald-600 hover:bg-emerald-700 shadow-sm disabled:opacity-70 min-w-[100px]"
                  >
                    {saving ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Saving…
                      </>
                    ) : (
                      'Save'
                    )}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
