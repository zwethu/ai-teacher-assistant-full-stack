import { useState, type FormEvent } from 'react'
import type { ToastMessage } from '../types'
import type { Batch } from '../entity/Batch'
import Toast from '../components/ui/Toast'
import { getErrorMessage } from '../utils/errors'

import {
  ChevronDown,
  Eye,
  Layers,
  Loader2,
  Plus,
  Sparkles,
  Trash2,
  Users,
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
import { fromFirestore, toFirestore } from '../entity/Batch'
import { generateBatchContent } from '../services/agentService'
import {
  formatBatchItemContent as formatItemContent,
  getBatchItemsFromRecord as getBatchItems,
} from '../utils/content'
import { timeAgo } from '../utils/formatDate'

const GRADES = Array.from({ length: 12 }, (_, i) => `Grade ${i + 1}`)
const BATCH_TYPES = ['Assessment', 'Lesson Plan', 'Worksheet']

const INITIAL_FORM = {
  name: '',
  subject: '',
  grade: 'Grade 6',
  type: 'Assessment',
  numberOfItems: 5,
  topic: '',
}

function typeBadgeClass(type: string) {
  switch (type) {
    case 'Lesson Plan':
      return 'bg-blue-50 text-blue-700 border-blue-200'
    case 'Worksheet':
      return 'bg-violet-50 text-violet-700 border-violet-200'
    default:
      return 'bg-emerald-50 text-emerald-700 border-emerald-200'
  }
}

function batchDisplayName(item: Batch) {
  return item.name || item.topic || item.subject || 'Untitled Batch'
}

export default function Batches() {
  const { user } = useAuth()

  const {
    items: batches,
    loading: listLoading,
    error: listError,
  } = useUserCollection({
    collectionName: 'batches',
    uid: user?.uid,
    fromFirestore,
  })
  const [createOpen, setCreateOpen] = useState(false)
  const [viewItem, setViewItem] = useState<Batch | null>(null)
  const [openAccordionIndex, setOpenAccordionIndex] = useState(0)
  const [form, setForm] = useState(INITIAL_FORM)
  const [generating, setGenerating] = useState(false)
  const [toast, setToast] = useState<ToastMessage | null>(null)

  const itemCount = Math.min(10, Math.max(2, Number(form.numberOfItems) || 2))

  function showToast(type: ToastMessage['type'], message: string) {
    setToast({ type, message })
    window.setTimeout(() => setToast(null), 5000)
  }

  function openCreateModal() {
    setForm(INITIAL_FORM)
    setCreateOpen(true)
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault()

    if (!user) return

    setGenerating(true)
    try {
      const token = await user.getIdToken(true)
      const payload = {
        name: form.name.trim(),
        subject: form.subject.trim(),
        grade: form.grade,
        type: form.type,
        topic: form.topic.trim(),
        numberOfItems: itemCount,
      }

      const result = (await generateBatchContent(token, payload)) as { items?: unknown[]; content?: unknown }
      const items = result.items ?? []

      await addDoc(
        collection(db, 'batches'),
        toFirestore({
          uid: user.uid,
          name: payload.name,
          subject: payload.subject,
          grade: payload.grade,
          type: payload.type,
          topic: payload.topic,
          items,
          itemCount,
          content: result.content ?? null,
          createdAt: serverTimestamp(),
        }),
      )

      setCreateOpen(false)
      showToast('success', 'Batch generated and saved successfully.')
    } catch (err) {
      console.error(err)
      showToast('error', getErrorMessage(err, 'Failed to generate batch.'))
    } finally {
      setGenerating(false)
    }
  }

  async function handleDelete(item: Batch) {
    if (!item.id) return
    const title = batchDisplayName(item)
    if (!window.confirm(`Delete "${title}"? This cannot be undone.`)) return

    try {
      await deleteDoc(doc(db, 'batches', item.id))
      if (viewItem?.id === item.id) setViewItem(null)
      showToast('success', 'Batch deleted.')
    } catch (err) {
      console.error(err)
      showToast('error', 'Failed to delete batch.')
    }
  }

  function openView(item: Batch) {
    setViewItem(item)
    setOpenAccordionIndex(0)
  }

  const viewItems = viewItem ? getBatchItems(viewItem) : []

  return (
    <div>
      <Toast toast={toast} onDismiss={() => setToast(null)} />

      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 tracking-tight">
            Batches
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Generate multiple assessments, lesson plans, or worksheets in one run.
          </p>
        </div>
        <button
          type="button"
          onClick={openCreateModal}
          className="inline-flex items-center justify-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-emerald-600 hover:bg-emerald-700 shadow-sm transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-emerald-500"
        >
          <Plus className="w-5 h-5 mr-2 -ml-1" />
          Create New Batch
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
        {listLoading ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <Loader2 className="w-8 h-8 text-emerald-600 animate-spin" />
            <p className="text-sm text-slate-500">Loading batches…</p>
          </div>
        ) : listError ? (
          <div className="flex flex-col items-center justify-center py-16 px-6 text-center gap-2">
            <p className="text-sm font-medium text-red-700">{listError}</p>
            <p className="text-xs text-slate-500">
              Open DevTools → Console for details. Ensure Firestore allows authenticated
              reads on the batches collection.
            </p>
          </div>
        ) : batches.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center px-6">
            <div className="h-16 w-16 bg-slate-50 rounded-full flex items-center justify-center mb-4">
              <Users className="w-8 h-8 text-slate-300" />
            </div>
            <h3 className="text-sm font-medium text-slate-900">
              No batches yet. Create your first batch!
            </h3>
            <p className="mt-1 text-sm text-slate-500 mb-6">
              Produce several teaching materials on the same topic at once.
            </p>
            <button
              type="button"
              onClick={openCreateModal}
              className="inline-flex items-center justify-center px-4 py-2 text-sm font-medium rounded-md text-white bg-emerald-600 hover:bg-emerald-700 shadow-sm"
            >
              <Plus className="w-4 h-4 mr-2" />
              Create New Batch
            </button>
          </div>
        ) : (
          <div className="p-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {batches.map((item) => (
              <article
                key={item.id}
                className="group relative rounded-xl border border-slate-100 bg-white p-5 shadow-sm hover:shadow-md hover:border-emerald-200/80 transition-all"
              >
                <div className="flex items-start gap-3 mb-3">
                  <div className="flex-shrink-0 h-9 w-9 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center border border-emerald-100">
                    <Layers className="w-4 h-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-semibold text-slate-900 truncate group-hover:text-emerald-700 transition-colors">
                      {batchDisplayName(item)}
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5 truncate">
                      {item.subject || '—'}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 mb-3">
                  {item.grade && (
                    <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-700 border border-slate-200">
                      {item.grade}
                    </span>
                  )}
                  {item.type && (
                    <span
                      className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium border ${typeBadgeClass(item.type)}`}
                    >
                      {item.type}
                    </span>
                  )}
                  <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-slate-50 text-slate-600 border border-slate-200">
                    {item.itemCount ?? getBatchItems(item).length ?? 0} items
                  </span>
                </div>

                <p className="text-xs text-slate-400 mb-4">
                  {timeAgo(item.createdAt)}
                </p>

                <div className="flex items-center gap-2 pt-3 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => openView(item)}
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

      {createOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            onClick={() => !generating && setCreateOpen(false)}
            aria-hidden="true"
          />
          <div className="relative w-full max-w-lg rounded-xl bg-white shadow-2xl border border-slate-200 overflow-hidden max-h-[90vh] flex flex-col">
            <div className="bg-slate-50 px-6 py-4 border-b border-slate-200 flex items-center justify-between flex-shrink-0">
              <h3 className="text-lg font-semibold text-slate-800">
                Create New Batch
              </h3>
              <button
                type="button"
                onClick={() => !generating && setCreateOpen(false)}
                disabled={generating}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-md hover:bg-slate-200"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form
              onSubmit={handleCreate}
              className="p-6 space-y-4 overflow-y-auto flex-1"
            >
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                  Batch name
                </label>
                <input
                  type="text"
                  required
                  value={form.name}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, name: e.target.value }))
                  }
                  placeholder="e.g. Fractions Week 3 Pack"
                  className="block w-full rounded-md border border-slate-300 shadow-sm py-2.5 px-3 text-sm focus:border-emerald-500 focus:ring-emerald-500"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                    Type
                  </label>
                  <select
                    value={form.type}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, type: e.target.value }))
                    }
                    className="block w-full rounded-md border border-slate-300 shadow-sm py-2.5 px-2 text-sm focus:border-emerald-500 focus:ring-emerald-500"
                  >
                    {BATCH_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                    Number of items
                  </label>
                  <input
                    type="number"
                    min={2}
                    max={10}
                    required
                    value={form.numberOfItems}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        numberOfItems: Number(e.target.value),
                      }))
                    }
                    className="block w-full rounded-md border border-slate-300 shadow-sm py-2.5 px-3 text-sm focus:border-emerald-500 focus:ring-emerald-500"
                  />
                  <p className="text-xs text-slate-400 mt-1">Between 2 and 10 items.</p>
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
                  placeholder="e.g. Adding and subtracting fractions"
                  className="block w-full rounded-md border border-slate-300 shadow-sm py-2.5 px-3 text-sm focus:border-emerald-500 focus:ring-emerald-500"
                />
              </div>

              {generating && (
                <div className="flex items-center gap-3 rounded-lg bg-emerald-50 border border-emerald-100 px-4 py-3">
                  <Loader2 className="w-5 h-5 text-emerald-600 animate-spin flex-shrink-0" />
                  <p className="text-sm text-emerald-800">
                    Generating batch… This may take 15–30 seconds.
                  </p>
                </div>
              )}

              <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setCreateOpen(false)}
                  disabled={generating}
                  className="px-4 py-2 text-sm font-medium rounded-md border border-slate-300 text-slate-700 bg-white hover:bg-slate-50 disabled:opacity-60"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={generating}
                  className="inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium rounded-md text-white bg-emerald-600 hover:bg-emerald-700 shadow-sm disabled:opacity-70 disabled:cursor-not-allowed min-w-[180px]"
                >
                  {generating ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Generating batch…
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4" />
                      Create Batch
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
            <div className="bg-emerald-50 px-6 py-4 border-b border-emerald-100 flex items-center justify-between flex-shrink-0">
              <div>
                <h3 className="text-lg font-semibold text-emerald-900">
                  {batchDisplayName(viewItem)}
                </h3>
                <div className="flex flex-wrap gap-2 mt-2 items-center">
                  <span className="text-xs text-slate-600">{viewItem.subject}</span>
                  {viewItem.grade && (
                    <span className="text-xs text-slate-400">· {viewItem.grade}</span>
                  )}
                  {viewItem.type && (
                    <span
                      className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium border ${typeBadgeClass(viewItem.type)}`}
                    >
                      {viewItem.type}
                    </span>
                  )}
                  <span className="text-xs text-slate-500">
                    · {viewItem.itemCount ?? viewItems.length} items
                  </span>
                </div>
                {viewItem.topic && (
                  <p className="text-xs text-slate-500 mt-1">Topic: {viewItem.topic}</p>
                )}
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
              {viewItems.length === 0 ? (
                <pre className="whitespace-pre-wrap text-sm text-slate-700 font-sans leading-relaxed">
                  {formatItemContent(viewItem.content) || 'No items in this batch.'}
                </pre>
              ) : (
                <div className="space-y-2">
                  {viewItems.map((item, index) => {
                    const record = item as Record<string, unknown>
                    const isOpen = openAccordionIndex === index
                    const label =
                      (record.title as string | undefined) ||
                      (record.name as string | undefined) ||
                      `${viewItem.type || 'Item'} ${(record.index as number | undefined) ?? index + 1}`

                    return (
                      <div
                        key={index}
                        className="rounded-lg border border-slate-200 overflow-hidden"
                      >
                        <button
                          type="button"
                          onClick={() =>
                            setOpenAccordionIndex(isOpen ? -1 : index)
                          }
                          className="w-full flex items-center justify-between gap-3 px-4 py-3 bg-slate-50 hover:bg-slate-100 text-left transition-colors"
                        >
                          <span className="text-sm font-semibold text-slate-800">
                            {label}
                          </span>
                          <ChevronDown
                            className={`w-4 h-4 text-slate-500 flex-shrink-0 transition-transform ${
                              isOpen ? 'rotate-180' : ''
                            }`}
                          />
                        </button>
                        {isOpen && (
                          <div className="px-4 py-4 border-t border-slate-100 bg-white">
                            <pre className="whitespace-pre-wrap text-sm text-slate-700 font-sans leading-relaxed">
                              {formatItemContent(item)}
                            </pre>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
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
