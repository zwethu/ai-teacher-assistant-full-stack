import { useState, type FormEvent } from 'react'
import type { ToastMessage } from '../types'
import type { LessonPlan } from '../entity/LessonPlan'
import Toast from '../components/ui/Toast'
import { getErrorMessage } from '../utils/errors'

import {
  BookOpen,
  Clock,
  Eye,
  FileText,
  Loader2,
  Plus,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react'
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  serverTimestamp,
} from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useAuth } from '../hooks/useAuth'
import { useUserCollection } from '../hooks/useUserCollection'
import { fromFirestore, toFirestore } from '../entity/LessonPlan'
import { generateLessonPlan } from '../services/agentService'
import { formatLessonPlanContent as formatContentForDisplay } from '../utils/content'
import { timeAgo } from '../utils/formatDate'

const GRADES = Array.from({ length: 12 }, (_, i) => `Grade ${i + 1}`)
const DURATIONS = ['30 min', '45 min', '60 min', '90 min']

const INITIAL_FORM = {
  subject: '',
  grade: 'Grade 6',
  topic: '',
  duration: '45 min',
  objectives: '',
}

function planTitle(item: LessonPlan) {
  if (item.topic) return item.topic
  if (item.subject) return item.subject
  return 'Untitled Lesson Plan'
}

export default function LessonPlans() {
  const { user } = useAuth()

  const {
    items: lessonPlans,
    loading: listLoading,
    error: listError,
  } = useUserCollection({
    collectionName: 'lesson_plans',
    uid: user?.uid,
    fromFirestore,
  })
  const [generateOpen, setGenerateOpen] = useState(false)
  const [viewItem, setViewItem] = useState<LessonPlan | null>(null)
  const [form, setForm] = useState(INITIAL_FORM)
  const [generating, setGenerating] = useState(false)
  const [toast, setToast] = useState<ToastMessage | null>(null)

  function showToast(type: ToastMessage['type'], message: string) {
    setToast({ type, message })
    window.setTimeout(() => setToast(null), 5000)
  }

  function openGenerateModal() {
    setForm(INITIAL_FORM)
    setGenerateOpen(true)
  }

  async function handleGenerate(e: FormEvent) {
    e.preventDefault()

    if (!user) return

    setGenerating(true)
    try {
      const token = await user.getIdToken(true)
      const payload = {
        subject: form.subject.trim(),
        grade: form.grade,
        topic: form.topic.trim(),
        duration: form.duration,
        objectives: form.objectives.trim(),
      }

      const result = await generateLessonPlan(token, payload)

      await addDoc(
        collection(db, 'lesson_plans'),
        toFirestore({
          uid: user.uid,
          subject: payload.subject,
          grade: payload.grade,
          topic: payload.topic,
          duration: payload.duration,
          objectives: payload.objectives,
          content: result,
          createdAt: serverTimestamp(),
        }),
      )

      setGenerateOpen(false)
      showToast('success', 'Lesson plan generated and saved successfully.')
    } catch (err) {
      console.error(err)
      showToast('error', getErrorMessage(err, 'Failed to generate lesson plan.'))
    } finally {
      setGenerating(false)
    }
  }

  async function handleDelete(item: LessonPlan) {
    if (!item.id) return
    const title = planTitle(item)
    if (!window.confirm(`Delete "${title}"? This cannot be undone.`)) return

    try {
      await deleteDoc(doc(db, 'lesson_plans', item.id))
      if (viewItem?.id === item.id) setViewItem(null)
      showToast('success', 'Lesson plan deleted.')
    } catch (err) {
      console.error(err)
      showToast('error', 'Failed to delete lesson plan.')
    }
  }

  return (
    <div>
      <Toast toast={toast} onDismiss={() => setToast(null)} />

      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 tracking-tight">
            Lesson Plans
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Manage and preview your generated course content.
          </p>
        </div>
        <button
          type="button"
          onClick={openGenerateModal}
          className="inline-flex items-center justify-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-emerald-600 hover:bg-emerald-700 shadow-lg shadow-emerald-500/20 hover:shadow-xl hover:-translate-y-0.5 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-emerald-500"
        >
          <Plus className="w-5 h-5 mr-2 -ml-1" />
          Generate New
        </button>
      </div>

      <div className="relative group overflow-hidden rounded-2xl border border-slate-100 bg-white/90 shadow-sm">
        <div className="pointer-events-none absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500">
          <div className="absolute -top-16 -right-10 w-40 h-40 bg-emerald-400/22 blur-3xl" />
          <div className="absolute -bottom-16 -left-10 w-40 h-40 bg-sky-400/20 blur-3xl" />
        </div>

        <div className="relative z-10 rounded-2xl bg-white">
          {listLoading ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3">
              <Loader2 className="w-8 h-8 text-emerald-600 animate-spin" />
              <p className="text-sm text-slate-500">Loading lesson plans…</p>
            </div>
          ) : listError ? (
            <div className="flex flex-col items-center justify-center py-16 px-6 text-center gap-2">
              <p className="text-sm font-medium text-red-700">{listError}</p>
            </div>
          ) : lessonPlans.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center px-6">
              <div className="h-16 w-16 bg-slate-50 rounded-full flex items-center justify-center mb-4">
                <FileText className="w-8 h-8 text-slate-300" />
              </div>
              <h3 className="text-sm font-medium text-slate-900">
                No lesson plans yet. Generate your first one!
              </h3>
              <p className="mt-1 text-sm text-slate-500 mb-6">
                Build structured lessons with AI in seconds.
              </p>
              <button
                type="button"
                onClick={openGenerateModal}
                className="inline-flex items-center justify-center px-4 py-2 text-sm font-medium rounded-md text-white bg-emerald-600 hover:bg-emerald-700 shadow-sm"
              >
                <Plus className="w-4 h-4 mr-2" />
                Generate New
              </button>
            </div>
          ) : (
            <div className="p-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {lessonPlans.map((item) => (
                <article
                  key={item.id}
                  className="group relative rounded-xl border border-slate-100 bg-white p-5 shadow-sm hover:shadow-md hover:border-emerald-200/80 transition-all"
                >
                  <div className="flex items-start gap-3 mb-3">
                    <div className="flex-shrink-0 h-9 w-9 rounded-lg bg-sky-50 text-sky-600 flex items-center justify-center border border-sky-100">
                      <BookOpen className="w-4 h-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="font-semibold text-slate-900 truncate group-hover:text-emerald-700 transition-colors">
                        {planTitle(item)}
                      </h3>
                      <p className="text-xs text-slate-500 mt-0.5 truncate">
                        {item.subject || '—'}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 mb-4">
                    {item.grade && (
                      <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-700 border border-slate-200">
                        {item.grade}
                      </span>
                    )}
                    {item.duration && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200">
                        <Clock className="w-3 h-3" />
                        {item.duration}
                      </span>
                    )}
                  </div>

                  <p className="text-xs text-slate-400 mb-4">
                    {timeAgo(item.createdAt)}
                  </p>

                  <div className="flex items-center gap-2 pt-3 border-t border-slate-100">
                    <button
                      type="button"
                      onClick={() => setViewItem(item)}
                      className="inline-flex flex-1 items-center justify-center gap-1.5 px-3 py-1.5 border border-slate-300 shadow-sm text-xs font-medium rounded-md text-slate-700 bg-white hover:bg-slate-50 transition-all"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      View
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(item)}
                      className="inline-flex items-center justify-center px-3 py-1.5 border border-slate-300 shadow-sm text-xs font-medium rounded-md text-slate-700 bg-white hover:bg-red-50 hover:text-red-600 hover:border-red-200 transition-all"
                      aria-label="Delete"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </div>

      {generateOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            onClick={() => !generating && setGenerateOpen(false)}
            aria-hidden="true"
          />
          <div className="relative w-full max-w-lg rounded-xl bg-white shadow-2xl border border-slate-200 overflow-hidden max-h-[90vh] flex flex-col">
            <div className="bg-slate-50 px-6 py-4 border-b border-slate-200 flex items-center justify-between flex-shrink-0">
              <h3 className="text-lg font-semibold text-slate-800">
                Generate Lesson Plan
              </h3>
              <button
                type="button"
                onClick={() => !generating && setGenerateOpen(false)}
                disabled={generating}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-md hover:bg-slate-200"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form
              onSubmit={handleGenerate}
              className="p-6 space-y-4 overflow-y-auto flex-1"
            >
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
                  placeholder="e.g. Science"
                  className="block w-full rounded-md border border-slate-300 shadow-sm py-2.5 px-3 text-sm focus:border-emerald-500 focus:ring-emerald-500"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                    Grade
                  </label>
                  <select
                    value={form.grade}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, grade: e.target.value }))
                    }
                    className="block w-full rounded-md border border-slate-300 shadow-sm py-2.5 px-2 text-sm focus:border-emerald-500 focus:ring-emerald-500"
                  >
                    {GRADES.map((g) => (
                      <option key={g} value={g}>
                        {g}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                    Duration
                  </label>
                  <select
                    value={form.duration}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, duration: e.target.value }))
                    }
                    className="block w-full rounded-md border border-slate-300 shadow-sm py-2.5 px-2 text-sm focus:border-emerald-500 focus:ring-emerald-500"
                  >
                    {DURATIONS.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                  Topic
                </label>
                <input
                  type="text"
                  required
                  value={form.topic}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, topic: e.target.value }))
                  }
                  placeholder="e.g. Photosynthesis"
                  className="block w-full rounded-md border border-slate-300 shadow-sm py-2.5 px-3 text-sm focus:border-emerald-500 focus:ring-emerald-500"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                  Learning objectives
                </label>
                <textarea
                  required
                  rows={4}
                  value={form.objectives}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, objectives: e.target.value }))
                  }
                  placeholder="What should students know or be able to do by the end of the lesson?"
                  className="block w-full rounded-md border border-slate-300 shadow-sm py-2.5 px-3 text-sm focus:border-emerald-500 focus:ring-emerald-500 resize-y"
                />
              </div>

              {generating && (
                <div className="flex items-center gap-3 rounded-lg bg-emerald-50 border border-emerald-100 px-4 py-3">
                  <Loader2 className="w-5 h-5 text-emerald-600 animate-spin flex-shrink-0" />
                  <p className="text-sm text-emerald-800">
                    Generating lesson plan… This may take 5–15 seconds.
                  </p>
                </div>
              )}

              <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setGenerateOpen(false)}
                  disabled={generating}
                  className="px-4 py-2 text-sm font-medium rounded-md border border-slate-300 text-slate-700 bg-white hover:bg-slate-50 disabled:opacity-60"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={generating}
                  className="inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium rounded-md text-white bg-emerald-600 hover:bg-emerald-700 shadow-sm disabled:opacity-70 disabled:cursor-not-allowed min-w-[140px]"
                >
                  {generating ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Generating…
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4" />
                      Generate
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {viewItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            onClick={() => setViewItem(null)}
            aria-hidden="true"
          />
          <div className="relative w-full max-w-3xl max-h-[90vh] flex flex-col rounded-xl bg-white shadow-2xl border border-slate-200 overflow-hidden">
            <div className="bg-sky-50 px-6 py-4 border-b border-sky-100 flex items-center justify-between flex-shrink-0">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">
                  {planTitle(viewItem)}
                </h3>
                <div className="flex flex-wrap gap-2 mt-2 items-center">
                  <span className="text-xs text-slate-600">{viewItem.subject}</span>
                  {viewItem.grade && (
                    <span className="text-xs text-slate-400">· {viewItem.grade}</span>
                  )}
                  {viewItem.duration && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200">
                      <Clock className="w-3 h-3" />
                      {viewItem.duration}
                    </span>
                  )}
                </div>
                {viewItem.objectives && (
                  <p className="text-xs text-slate-500 mt-2 line-clamp-2">
                    <span className="font-medium">Objectives:</span>{' '}
                    {viewItem.objectives}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setViewItem(null)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-md hover:bg-sky-100"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              <pre className="whitespace-pre-wrap text-sm text-slate-700 font-sans leading-relaxed">
                {formatContentForDisplay(viewItem.content)}
              </pre>
            </div>
            <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 flex justify-end gap-2 flex-shrink-0">
              <button
                type="button"
                onClick={() => handleDelete(viewItem)}
                className="px-4 py-2 text-sm font-medium rounded-md border border-red-200 text-red-700 bg-white hover:bg-red-50"
              >
                Delete
              </button>
              <button
                type="button"
                onClick={() => setViewItem(null)}
                className="px-4 py-2 text-sm font-medium rounded-md text-white bg-emerald-600 hover:bg-emerald-700"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
