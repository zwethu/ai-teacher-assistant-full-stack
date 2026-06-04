import { useEffect, useState } from 'react'
import {
  BarChart3,
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
  increment,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore'
import { db } from '../lib/firebase.js'
import { useAuth } from '../hooks/useAuth.js'
import { useCredits } from '../hooks/useCredits.js'
import { fromFirestore, toFirestore } from '../entity/Assessment.js'
import { generateAssessment } from '../services/agentService.js'
import { timeAgo } from '../utils/formatDate.js'

const GRADES = Array.from({ length: 12 }, (_, i) => `Grade ${i + 1}`)
const DIFFICULTIES = ['Easy', 'Medium', 'Hard']

const INITIAL_FORM = {
  subject: '',
  grade: 'Grade 6',
  topic: '',
  difficulty: 'Medium',
  numberOfQuestions: 10,
}

function difficultyBadgeClass(difficulty) {
  switch (difficulty) {
    case 'Easy':
      return 'bg-emerald-50 text-emerald-700 border-emerald-200'
    case 'Hard':
      return 'bg-red-50 text-red-700 border-red-200'
    default:
      return 'bg-amber-50 text-amber-800 border-amber-200'
  }
}

function Toast({ toast, onDismiss }) {
  if (!toast) return null

  const isError = toast.type === 'error'

  return (
    <div
      className={`fixed bottom-6 right-6 z-[100] max-w-sm rounded-xl border px-4 py-3 shadow-lg flex items-start gap-3 ${
        isError
          ? 'bg-red-50 border-red-200 text-red-800'
          : 'bg-emerald-50 border-emerald-200 text-emerald-800'
      }`}
      role="status"
    >
      <p className="text-sm font-medium flex-1">{toast.message}</p>
      <button
        type="button"
        onClick={onDismiss}
        className="p-1 rounded-md hover:bg-black/5"
        aria-label="Dismiss"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  )
}

function formatContentForDisplay(content) {
  if (!content) return 'No content available.'

  if (typeof content === 'string') {
    try {
      const parsed = JSON.parse(content)
      return formatContentForDisplay(parsed)
    } catch {
      return content
    }
  }

  if (content.markdown) return content.markdown

  if (Array.isArray(content.questions)) {
    return content.questions
      .map((q, i) => {
        const opts = (q.options || [])
          .map((o) => `  - ${o}`)
          .join('\n')
        return `${i + 1}. ${q.question || q.text || 'Question'}\n${opts}\n${q.answer ? `Answer: ${q.answer}` : ''}`
      })
      .join('\n\n')
  }

  return JSON.stringify(content, null, 2)
}

function assessmentTitle(item) {
  if (item.topic) return item.topic
  if (item.subject) return item.subject
  return 'Untitled Assessment'
}

export default function Assessments() {
  const { user } = useAuth()
  const { credits, loading: creditsLoading } = useCredits()

  const [assessments, setAssessments] = useState([])
  const [listLoading, setListLoading] = useState(true)
  const [generateOpen, setGenerateOpen] = useState(false)
  const [viewItem, setViewItem] = useState(null)
  const [form, setForm] = useState(INITIAL_FORM)
  const [generating, setGenerating] = useState(false)
  const [toast, setToast] = useState(null)

  useEffect(() => {
    if (!user?.uid) {
      setAssessments([])
      setListLoading(false)
      return undefined
    }

    setListLoading(true)
    const q = query(
      collection(db, 'assessments'),
      where('uid', '==', user.uid),
      orderBy('createdAt', 'desc'),
    )

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        setAssessments(
          snapshot.docs.map((d) => fromFirestore(d)).filter(Boolean),
        )
        setListLoading(false)
      },
      (error) => {
        console.error('Failed to load assessments:', error)
        setListLoading(false)
        setToast({
          type: 'error',
          message: 'Could not load assessments. Check Firestore rules and indexes.',
        })
      },
    )

    return unsubscribe
  }, [user?.uid])

  function showToast(type, message) {
    setToast({ type, message })
    window.setTimeout(() => setToast(null), 5000)
  }

  function openGenerateModal() {
    if (!creditsLoading && credits <= 0) {
      showToast('error', 'You have no credits left. Cannot generate an assessment.')
      return
    }
    setForm(INITIAL_FORM)
    setGenerateOpen(true)
  }

  async function handleGenerate(e) {
    e.preventDefault()

    if (credits <= 0) {
      showToast('error', 'You have no credits left. Cannot generate an assessment.')
      return
    }

    if (!user) return

    setGenerating(true)
    try {
      const token = await user.getIdToken(true)
      const payload = {
        subject: form.subject.trim(),
        grade: form.grade,
        topic: form.topic.trim(),
        difficulty: form.difficulty,
        numberOfQuestions: Number(form.numberOfQuestions),
      }

      const result = await generateAssessment(token, payload)

      await addDoc(
        collection(db, 'assessments'),
        toFirestore({
          uid: user.uid,
          subject: payload.subject,
          grade: payload.grade,
          topic: payload.topic,
          difficulty: payload.difficulty,
          content: result,
          createdAt: serverTimestamp(),
        }),
      )

      await updateDoc(doc(db, 'users', user.uid), {
        credits: increment(-1),
      })

      setGenerateOpen(false)
      showToast('success', 'Assessment generated and saved successfully.')
    } catch (err) {
      console.error(err)
      showToast('error', err.message || 'Failed to generate assessment.')
    } finally {
      setGenerating(false)
    }
  }

  async function handleDelete(item) {
    const title = assessmentTitle(item)
    if (!window.confirm(`Delete "${title}"? This cannot be undone.`)) return

    try {
      await deleteDoc(doc(db, 'assessments', item.id))
      if (viewItem?.id === item.id) setViewItem(null)
      showToast('success', 'Assessment deleted.')
    } catch (err) {
      console.error(err)
      showToast('error', 'Failed to delete assessment.')
    }
  }

  return (
    <div>
      <Toast toast={toast} onDismiss={() => setToast(null)} />

      {/* Page header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 tracking-tight">
            Assessments
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Manage quizzes, exams, and grading rubrics.
          </p>
        </div>
        <button
          type="button"
          onClick={openGenerateModal}
          disabled={creditsLoading}
          className="inline-flex items-center justify-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-emerald-600 hover:bg-emerald-700 shadow-sm transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-emerald-500 disabled:opacity-60"
        >
          <Plus className="w-5 h-5 mr-2 -ml-1" />
          Generate New
        </button>
      </div>

      {/* List */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
        {listLoading ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <Loader2 className="w-8 h-8 text-emerald-600 animate-spin" />
            <p className="text-sm text-slate-500">Loading assessments…</p>
          </div>
        ) : assessments.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center px-6">
            <div className="h-16 w-16 bg-slate-50 rounded-full flex items-center justify-center mb-4">
              <FileText className="w-8 h-8 text-slate-300" />
            </div>
            <h3 className="text-sm font-medium text-slate-900">
              No assessments yet. Generate your first one!
            </h3>
            <p className="mt-1 text-sm text-slate-500 mb-6">
              Create quizzes and exams with AI in seconds.
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
            {assessments.map((item) => (
              <article
                key={item.id}
                className="group relative rounded-xl border border-slate-100 bg-white p-5 shadow-sm hover:shadow-md hover:border-emerald-200/80 transition-all"
              >
                <div className="flex items-start gap-3 mb-3">
                  <div className="flex-shrink-0 h-9 w-9 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center border border-emerald-100">
                    <BarChart3 className="w-4 h-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-semibold text-slate-900 truncate group-hover:text-emerald-700 transition-colors">
                      {assessmentTitle(item)}
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
                  {item.difficulty && (
                    <span
                      className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium border ${difficultyBadgeClass(item.difficulty)}`}
                    >
                      {item.difficulty}
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

      {/* Generate modal */}
      {generateOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            onClick={() => !generating && setGenerateOpen(false)}
            aria-hidden="true"
          />
          <div className="relative w-full max-w-lg rounded-xl bg-white shadow-2xl border border-slate-200 overflow-hidden">
            <div className="bg-slate-50 px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-slate-800">
                Generate Assessment
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

            <form onSubmit={handleGenerate} className="p-6 space-y-4">
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
                    Difficulty
                  </label>
                  <select
                    value={form.difficulty}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, difficulty: e.target.value }))
                    }
                    className="block w-full rounded-md border border-slate-300 shadow-sm py-2.5 px-2 text-sm focus:border-emerald-500 focus:ring-emerald-500"
                  >
                    {DIFFICULTIES.map((d) => (
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
                  placeholder="e.g. Fractions and decimals"
                  className="block w-full rounded-md border border-slate-300 shadow-sm py-2.5 px-3 text-sm focus:border-emerald-500 focus:ring-emerald-500"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                  Number of questions
                </label>
                <input
                  type="number"
                  min={5}
                  max={20}
                  required
                  value={form.numberOfQuestions}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      numberOfQuestions: Number(e.target.value),
                    }))
                  }
                  className="block w-full rounded-md border border-slate-300 shadow-sm py-2.5 px-3 text-sm focus:border-emerald-500 focus:ring-emerald-500"
                />
                <p className="text-xs text-slate-400 mt-1">Between 5 and 20 questions.</p>
              </div>

              {generating && (
                <div className="flex items-center gap-3 rounded-lg bg-emerald-50 border border-emerald-100 px-4 py-3">
                  <Loader2 className="w-5 h-5 text-emerald-600 animate-spin flex-shrink-0" />
                  <p className="text-sm text-emerald-800">
                    Generating assessment… This may take 5–15 seconds.
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
                  disabled={generating || credits <= 0}
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

      {/* View detail modal */}
      {viewItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            onClick={() => setViewItem(null)}
            aria-hidden="true"
          />
          <div className="relative w-full max-w-3xl max-h-[90vh] flex flex-col rounded-xl bg-white shadow-2xl border border-slate-200 overflow-hidden">
            <div className="bg-emerald-50 px-6 py-4 border-b border-emerald-100 flex items-center justify-between flex-shrink-0">
              <div>
                <h3 className="text-lg font-semibold text-emerald-900">
                  {assessmentTitle(viewItem)}
                </h3>
                <div className="flex flex-wrap gap-2 mt-2">
                  <span className="text-xs text-slate-600">{viewItem.subject}</span>
                  {viewItem.grade && (
                    <span className="text-xs text-slate-400">· {viewItem.grade}</span>
                  )}
                  {viewItem.difficulty && (
                    <span
                      className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium border ${difficultyBadgeClass(viewItem.difficulty)}`}
                    >
                      {viewItem.difficulty}
                    </span>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setViewItem(null)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-md hover:bg-emerald-100"
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
