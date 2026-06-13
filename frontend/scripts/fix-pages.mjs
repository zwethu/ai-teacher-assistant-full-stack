import fs from 'fs'
import path from 'path'

const pagesDir = path.join('src/pages')

function removeLocalToast(content) {
  return content.replace(
    /function Toast\(\{ toast, onDismiss \}\) \{[\s\S]*?\n\}\n\n/g,
    '',
  )
}

function patchFile(name, patches) {
  const file = path.join(pagesDir, `${name}.tsx`)
  let content = fs.readFileSync(file, 'utf8')
  for (const [from, to] of patches) {
    if (!content.includes(from)) {
      console.warn(`[${name}] pattern not found:`, from.slice(0, 60))
    }
    content = content.replace(from, to)
  }
  content = removeLocalToast(content)
  fs.writeFileSync(file, content)
  console.log('Patched', name)
}

const toastImport =
  "import Toast from '../components/ui/Toast'\nimport { getErrorMessage } from '../utils/errors'\n"

patchFile('Assessments', [
  [
    "import { useState } from 'react'",
    "import { useState, type FormEvent } from 'react'\nimport type { ToastMessage } from '../types'\nimport type { Assessment } from '../entity/Assessment'\n" +
      toastImport,
  ],
  ['function difficultyBadgeClass(difficulty)', 'function difficultyBadgeClass(difficulty: string)'],
  ['function formatContentForDisplay(content)', 'function formatContentForDisplay(content: unknown)'],
  ['function assessmentTitle(item)', 'function assessmentTitle(item: Assessment)'],
  ['const [viewItem, setViewItem] = useState(null)', 'const [viewItem, setViewItem] = useState<Assessment | null>(null)'],
  ['const [toast, setToast] = useState(null)', 'const [toast, setToast] = useState<ToastMessage | null>(null)'],
  ['function showToast(type, message)', "function showToast(type: ToastMessage['type'], message: string)"],
  ['async function handleGenerate(e)', 'async function handleGenerate(e: FormEvent)'],
  ["showToast('error', err.message || 'Failed to generate assessment.')", "showToast('error', getErrorMessage(err, 'Failed to generate assessment.'))"],
  ['async function handleDelete(item)', 'async function handleDelete(item: Assessment)'],
])

patchFile('LessonPlans', [
  [
    "import { useState } from 'react'",
    "import { useState, type FormEvent } from 'react'\nimport type { ToastMessage } from '../types'\nimport type { LessonPlan } from '../entity/LessonPlan'\n" +
      toastImport,
  ],
  ['function formatContentForDisplay(content)', 'function formatContentForDisplay(content: unknown)'],
  ['function planTitle(item)', 'function planTitle(item: LessonPlan)'],
  ['const [viewItem, setViewItem] = useState(null)', 'const [viewItem, setViewItem] = useState<LessonPlan | null>(null)'],
  ['const [toast, setToast] = useState(null)', 'const [toast, setToast] = useState<ToastMessage | null>(null)'],
  ['function showToast(type, message)', "function showToast(type: ToastMessage['type'], message: string)"],
  ['async function handleGenerate(e)', 'async function handleGenerate(e: FormEvent)'],
  ["showToast('error', err.message || 'Failed to generate lesson plan.')", "showToast('error', getErrorMessage(err, 'Failed to generate lesson plan.'))"],
  ['async function handleDelete(item)', 'async function handleDelete(item: LessonPlan)'],
])

patchFile('Batches', [
  [
    "import { useState } from 'react'",
    "import { useState, type FormEvent } from 'react'\nimport type { ToastMessage } from '../types'\nimport type { Batch } from '../entity/Batch'\n" +
      toastImport,
  ],
  ['function typeBadgeClass(type)', 'function typeBadgeClass(type: string)'],
  ['function formatItemContent(item)', 'function formatItemContent(item: unknown)'],
  ['function getBatchItems(batch)', 'function getBatchItems(batch: Batch)'],
  ['function batchDisplayName(item)', 'function batchDisplayName(item: Batch)'],
  ['const [viewItem, setViewItem] = useState(null)', 'const [viewItem, setViewItem] = useState<Batch | null>(null)'],
  ['const [toast, setToast] = useState(null)', 'const [toast, setToast] = useState<ToastMessage | null>(null)'],
  ['function showToast(type, message)', "function showToast(type: ToastMessage['type'], message: string)"],
  ['async function handleCreate(e)', 'async function handleCreate(e: FormEvent)'],
  [
    'const result = await generateBatchContent(token, payload)',
    'const result = (await generateBatchContent(token, payload)) as { items?: unknown[]; content?: unknown }',
  ],
  ["showToast('error', err.message || 'Failed to generate batch.')", "showToast('error', getErrorMessage(err, 'Failed to generate batch.'))"],
  ['async function handleDelete(item)', 'async function handleDelete(item: Batch)'],
  ['function openView(item)', 'function openView(item: Batch)'],
])

patchFile('Email', [
  [
    "import { useEffect, useState } from 'react'",
    "import { useEffect, useState, type FormEvent } from 'react'\nimport type { ToastMessage } from '../types'\nimport type { Email as EmailRecord } from '../entity/Email'\n" +
      toastImport,
  ],
  ['const pad = (n) => String(n)', 'const pad = (n: number) => String(n)'],
  ['function truncateText(text, max = NOTES_PREVIEW_LEN)', 'function truncateText(text: string, max = NOTES_PREVIEW_LEN)'],
  ['function statusBadgeClass(status)', 'function statusBadgeClass(status: string)'],
  ['const [emails, setEmails] = useState([])', 'const [emails, setEmails] = useState<EmailRecord[]>([])'],
  ['const [modalMode, setModalMode] = useState(null)', "const [modalMode, setModalMode] = useState<'send' | 'schedule' | null>(null)"],
  ['const [toast, setToast] = useState(null)', 'const [toast, setToast] = useState<ToastMessage | null>(null)'],
  ['function showToast(type, message)', "function showToast(type: ToastMessage['type'], message: string)"],
  [
    'snapshot.docs.map((d) => fromFirestore(d)).filter(Boolean),',
    'snapshot.docs.map((d) => fromFirestore(d)).filter((d): d is EmailRecord => d !== null),',
  ],
  ["showToast('error', err.message || 'Could not start Google sign-in.')", "showToast('error', getErrorMessage(err, 'Could not start Google sign-in.'))"],
  ['async function handleSubmit(e)', 'async function handleSubmit(e: FormEvent)'],
  ['async function handleCancelScheduled(item)', 'async function handleCancelScheduled(item: EmailRecord)'],
])

patchFile('Login', [
  [
    "import { useState } from 'react'",
    "import { useState } from 'react'\n\ninterface ModalBackdropProps {\n  onClose: () => void\n}\n\ninterface ModalProps {\n  open: boolean\n  onClose: () => void\n}\n",
  ],
  ['function ModalBackdrop({ onClose })', 'function ModalBackdrop({ onClose }: ModalBackdropProps)'],
  ['function TermsModal({ open, onClose })', 'function TermsModal({ open, onClose }: ModalProps)'],
  ['if (!open) return 20', 'if (!open) return null'],
  ['function AboutModal({ open, onClose })', 'function AboutModal({ open, onClose }: ModalProps)'],
])

patchFile('Timetable', [
  [
    "import { useEffect, useMemo, useState } from 'react'",
    "import { useEffect, useMemo, useState, type FormEvent } from 'react'\nimport type { Timetable as TimetableEntry } from '../entity/Timetable'\nimport { getErrorMessage } from '../utils/errors'\n",
  ],
  ['function subjectPalette(subject)', 'function subjectPalette(subject: string)'],
  ['function buildGrid(entries)', 'function buildGrid(entries: TimetableEntry[])'],
  ['const [entries, setEntries] = useState([])', 'const [entries, setEntries] = useState<TimetableEntry[]>([])'],
  ['const [editingId, setEditingId] = useState(null)', 'const [editingId, setEditingId] = useState<string | null>(null)'],
  [
    'snapshot.docs.map((d) => fromFirestore(d)).filter(Boolean),',
    'snapshot.docs.map((d) => fromFirestore(d)).filter((d): d is TimetableEntry => d !== null),',
  ],
  ['function openAdd(day, period)', 'function openAdd(day: string, period: string)'],
  ['function openEdit(entry)', 'function openEdit(entry: TimetableEntry)'],
  ['function renderCell(day, period)', 'function renderCell(day: string, period: string)'],
])

patchFile('Wellness', [
  [
    "import { useEffect, useMemo, useState } from 'react'",
    "import { useEffect, useMemo, useState, type FormEvent } from 'react'\nimport type { Wellness as WellnessEntry } from '../entity/Wellness'\nimport { getErrorMessage } from '../utils/errors'\n",
  ],
  ['function formatEntryDate(entry)', 'function formatEntryDate(entry: WellnessEntry)'],
  ['function truncateNotes(notes, max = NOTES_PREVIEW_LEN)', 'function truncateNotes(notes: string, max = NOTES_PREVIEW_LEN)'],
  ['function buildMoodCounts(entries)', 'function buildMoodCounts(entries: WellnessEntry[])'],
  ['const [entries, setEntries] = useState([])', 'const [entries, setEntries] = useState<WellnessEntry[]>([])'],
  [
    'snapshot.docs.map((d) => fromFirestore(d)).filter(Boolean),',
    'snapshot.docs.map((d) => fromFirestore(d)).filter((d): d is WellnessEntry => d !== null),',
  ],
  ['async function handleAdd(e)', 'async function handleAdd(e: FormEvent)'],
  ['async function handleDelete(item)', 'async function handleDelete(item: WellnessEntry)'],
  ["setFormError(err.message || 'Failed to save entry.')", "setFormError(getErrorMessage(err, 'Failed to save entry.'))"],
])

console.log('Done')
