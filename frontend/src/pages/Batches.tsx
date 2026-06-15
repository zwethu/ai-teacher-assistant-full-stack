import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import type { ToastMessage } from '../types'
import type { Batch, BatchStudent } from '../entity/Batch'
import type { BatchFile, IndexStatus } from '../entity/File'
import Toast from '../components/ui/Toast'
import { getErrorMessage } from '../utils/errors'
import {
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  Clock,
  Eye,
  FileText,
  Loader2,
  Plus,
  Search,
  Trash2,
  Upload,
  UserPlus,
  Users,
  X,
  XCircle,
} from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import {
  addStudentToBatch,
  createBatch,
  deleteBatch,
  listBatches,
  listBatchStudents,
  removeStudentFromBatch,
} from '../services/batchService'
import { deleteBatchFile, listBatchFiles, uploadBatchFile } from '../services/fileService'
import { formatDate } from '../utils/formatDate'

type DetailTab = 'students' | 'materials'

type CreateStep = 'details' | 'method' | 'manual' | 'csv'
type StudentRow = { name: string; email: string }
type BatchWithCount = Batch

type BatchDetails = {
  batch_name: string
  course_name: string
  academic_year: string
  term: string
}

function parseCsv(text: string): StudentRow[] {
  const lines = text.trim().split(/\r?\n/).filter(Boolean)
  if (lines.length < 2) {
    throw new Error('CSV must have a header row and at least one data row.')
  }

  const headers = lines[0].split(',').map((h) => h.trim().toLowerCase())
  const nameIdx = headers.indexOf('name')
  const emailIdx = headers.indexOf('email')
  if (nameIdx === -1 || emailIdx === -1) {
    throw new Error('CSV must include "name" and "email" columns.')
  }

  return lines
    .slice(1)
    .map((line) => {
      const cols = line.split(',').map((c) => c.trim())
      return { name: cols[nameIdx] ?? '', email: cols[emailIdx] ?? '' }
    })
    .filter((r) => r.name && r.email)
}

const BTN_PRIMARY =
  'inline-flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-medium rounded-md text-white bg-emerald-600 hover:bg-emerald-700 shadow-sm disabled:opacity-70 disabled:cursor-not-allowed transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-emerald-500 min-h-[44px]'
const BTN_SECONDARY =
  'inline-flex items-center justify-center px-4 py-2 text-sm font-medium rounded-md border border-slate-300 text-slate-700 bg-white hover:bg-slate-50 disabled:opacity-60 transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-emerald-500'
const BTN_BACK =
  'inline-flex items-center justify-center px-3 py-2 text-sm font-medium text-slate-700 hover:text-slate-900 transition-colors'

const INPUT_CLASS =
  'block w-full rounded-md border border-emerald-200 bg-slate-50 focus:bg-white focus:border-emerald-500 py-2.5 px-3 text-sm'

function modalTitle(step: CreateStep): string {
  switch (step) {
    case 'details':
      return 'Create New Batch — Details'
    case 'csv':
      return 'Create Batch — Upload CSV'
    case 'manual':
      return 'Create Batch — Add Manually'
    default:
      return 'Create New Batch'
  }
}

export default function Batches() {
  const { user } = useAuth()

  const [batches, setBatches] = useState<BatchWithCount[]>([])
  const [listLoading, setListLoading] = useState(true)
  const [listError, setListError] = useState<string | null>(null)

  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [createStep, setCreateStep] = useState<CreateStep>('details')

  const [batchDetails, setBatchDetails] = useState<BatchDetails>({
    batch_name: '',
    course_name: '',
    academic_year: '',
    term: '',
  })

  const [manualStudents, setManualStudents] = useState<StudentRow[]>([])
  const [csvStudents, setCsvStudents] = useState<StudentRow[]>([])
  const [csvFileName, setCsvFileName] = useState<string | null>(null)
  const [tempName, setTempName] = useState('')
  const [tempEmail, setTempEmail] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [csvError, setCsvError] = useState<string | null>(null)
  const [createStatus, setCreateStatus] = useState<string | null>(null)

  const [selectedBatch, setSelectedBatch] = useState<Batch | null>(null)
  const [detailTab, setDetailTab] = useState<DetailTab>('students')
  const [students, setStudents] = useState<BatchStudent[]>([])
  const [studentsLoading, setStudentsLoading] = useState(false)

  const [studentForm, setStudentForm] = useState({ name: '', email: '' })
  const [addingStudent, setAddingStudent] = useState(false)
  const [csvUploading, setCsvUploading] = useState(false)

  // Course materials state
  const [files, setFiles] = useState<BatchFile[]>([])
  const [filesLoading, setFilesLoading] = useState(false)
  const [fileUploading, setFileUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const [searchQuery, setSearchQuery] = useState('')

  const [toast, setToast] = useState<ToastMessage | null>(null)

  const filteredBatches = batches.filter((batch) => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return true
    return (
      (batch.batch_name || 'Untitled Batch').toLowerCase().includes(q) ||
      (batch.course_name || '').toLowerCase().includes(q)
    )
  })

  function showToast(type: ToastMessage['type'], message: string) {
    setToast({ type, message })
    window.setTimeout(() => setToast(null), 5000)
  }

  function openCreateDialog() {
    setIsCreateOpen(true)
    setCreateStep('details')
    setBatchDetails({ batch_name: '', course_name: '', academic_year: '', term: '' })
    setManualStudents([])
    setCsvStudents([])
    setCsvFileName(null)
    setTempName('')
    setTempEmail('')
    setCsvError(null)
    setCreateStatus(null)
    setIsSubmitting(false)
  }

  function closeCreateDialog() {
    if (isSubmitting) return
    setIsCreateOpen(false)
  }

  const refreshBatches = useCallback(async () => {
    setListLoading(true)
    setListError(null)
    try {
      const data = await listBatches()
      setBatches(data)
    } catch (err) {
      console.error(err)
      setListError(getErrorMessage(err, 'Could not load batches.'))
    } finally {
      setListLoading(false)
    }
  }, [])

  const refreshStudents = useCallback(async () => {
    if (!selectedBatch) return
    setStudentsLoading(true)
    try {
      const data = await listBatchStudents(selectedBatch.id)
      setStudents(data)
    } catch (err) {
      console.error(err)
      showToast('error', getErrorMessage(err, 'Could not load students.'))
    } finally {
      setStudentsLoading(false)
    }
  }, [selectedBatch])

  const refreshFiles = useCallback(async () => {
    if (!selectedBatch) return
    setFilesLoading(true)
    try {
      const data = await listBatchFiles(selectedBatch.id)
      setFiles(data)
    } catch (err) {
      console.error(err)
      showToast('error', getErrorMessage(err, 'Could not load files.'))
    } finally {
      setFilesLoading(false)
    }
  }, [selectedBatch]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!user?.uid) {
      setBatches([])
      setListLoading(false)
      return
    }
    refreshBatches()
  }, [user?.uid, refreshBatches])

  useEffect(() => {
    if (!selectedBatch) {
      setStudents([])
      setFiles([])
      if (pollingRef.current) clearInterval(pollingRef.current)
      return
    }
    setDetailTab('students')
    refreshStudents()
    refreshFiles()
  }, [selectedBatch, refreshStudents, refreshFiles])

  // Poll files while any are in transitional states
  useEffect(() => {
    if (pollingRef.current) clearInterval(pollingRef.current)
    const transitional: IndexStatus[] = ['uploading', 'indexing', 'deleting']
    const needsPolling = files.some((f) => transitional.includes(f.index_status))
    if (!needsPolling || !selectedBatch) return
    pollingRef.current = setInterval(() => void refreshFiles(), 4000)
    return () => { if (pollingRef.current) clearInterval(pollingRef.current) }
  }, [files, selectedBatch, refreshFiles])

  function isDetailsComplete(): boolean {
    return (
      batchDetails.batch_name.trim() !== '' &&
      batchDetails.course_name.trim() !== '' &&
      batchDetails.academic_year.trim() !== '' &&
      batchDetails.term.trim() !== ''
    )
  }

  async function handleCreateWithStudents(studentRows: StudentRow[]) {
    if (!user?.uid || studentRows.length === 0) return
    if (!isDetailsComplete()) return

    setIsSubmitting(true)
    setCreateStatus('Creating batch…')
    try {
      const batchId = await createBatch({
        batch_name: batchDetails.batch_name.trim(),
        course_name: batchDetails.course_name.trim(),
        academic_year: batchDetails.academic_year.trim(),
        term: batchDetails.term.trim(),
        students: studentRows,
      })
      setIsCreateOpen(false)
      await refreshBatches()
      showToast(
        'success',
        `Batch "${batchDetails.batch_name}" created with ${studentRows.length} student${studentRows.length === 1 ? '' : 's'}.`,
      )
    } catch (err) {
      console.error(err)
      setCreateStatus(getErrorMessage(err, 'Failed to create batch.'))
      showToast('error', getErrorMessage(err, 'Failed to create batch.'))
    } finally {
      setIsSubmitting(false)
    }
  }

  function handleAddManualStudent() {
    const name = tempName.trim()
    const email = tempEmail.trim()
    if (!name) {
      showToast('error', 'Please enter student name.')
      return
    }
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      showToast('error', 'Please enter a valid email address.')
      return
    }
    setManualStudents((prev) => [...prev, { name, email }])
    setTempName('')
    setTempEmail('')
  }

  function handleCsvFileSelect(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    setCsvFileName(file.name)

    const reader = new FileReader()
    reader.onload = (event) => {
      try {
        const text = String(event.target?.result ?? '')
        const rows = parseCsv(text)
        if (rows.length === 0) {
          setCsvError('No valid student rows found in CSV.')
          setCsvStudents([])
          return
        }
        setCsvStudents(rows)
        setCsvError(null)
      } catch (err) {
        setCsvError(getErrorMessage(err, 'Failed to parse CSV file.'))
        setCsvStudents([])
      }
    }
    reader.readAsText(file)
  }

  async function handleDeleteBatch(batch: Batch) {
    if (
      !window.confirm(
        `Delete "${batch.batch_name}" and all its students? This cannot be undone.`,
      )
    ) {
      return
    }

    try {
      await deleteBatch(batch.id)
      if (selectedBatch?.id === batch.id) setSelectedBatch(null)
      await refreshBatches()
      showToast('success', 'Batch deleted.')
    } catch (err) {
      console.error(err)
      showToast('error', getErrorMessage(err, 'Failed to delete batch.'))
    }
  }

  async function handleAddStudent(e: FormEvent) {
    e.preventDefault()
    if (!selectedBatch) return

    const name = studentForm.name.trim()
    const email = studentForm.email.trim()
    if (!name || !email) return

    setAddingStudent(true)
    try {
      await addStudentToBatch(selectedBatch.id, name, email)
      setStudentForm({ name: '', email: '' })
      await refreshStudents()
      showToast('success', 'Student added.')
    } catch (err) {
      console.error(err)
      showToast('error', getErrorMessage(err, 'Failed to add student.'))
    } finally {
      setAddingStudent(false)
    }
  }

  async function handleRemoveStudent(student: BatchStudent) {
    if (!selectedBatch) return
    if (!window.confirm(`Remove "${student.name}" from this batch?`)) return

    try {
      await removeStudentFromBatch(selectedBatch.id, student.id)
      await refreshStudents()
      showToast('success', 'Student removed.')
    } catch (err) {
      console.error(err)
      showToast('error', getErrorMessage(err, 'Failed to remove student.'))
    }
  }

  async function handleCsvUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !selectedBatch) return

    setCsvUploading(true)
    try {
      const text = await file.text()
      const rows = parseCsv(text)
      if (rows.length === 0) {
        showToast('error', 'No valid student rows found in CSV.')
        return
      }

      await Promise.all(
        rows.map((row) => addStudentToBatch(selectedBatch.id, row.name, row.email)),
      )
      await refreshStudents()
      showToast('success', `Added ${rows.length} student${rows.length === 1 ? '' : 's'} from CSV.`)
    } catch (err) {
      console.error(err)
      showToast('error', getErrorMessage(err, 'Failed to import CSV.'))
    } finally {
      setCsvUploading(false)
    }
  }

  async function handleFileUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !selectedBatch) return

    setFileUploading(true)
    try {
      const uploaded = await uploadBatchFile(selectedBatch.id, file, file.name)
      setFiles((prev) => [uploaded, ...prev])
      showToast('success', `"${file.name}" uploaded — indexing started.`)
    } catch (err) {
      console.error(err)
      showToast('error', getErrorMessage(err, 'Failed to upload file.'))
    } finally {
      setFileUploading(false)
    }
  }

  async function handleDeleteFile(batchFile: BatchFile) {
    if (!selectedBatch) return
    if (!window.confirm(`Delete "${batchFile.file_name}"? This will also remove it from the search index.`)) return

    try {
      await deleteBatchFile(selectedBatch.id, batchFile.file_id)
      setFiles((prev) => prev.filter((f) => f.file_id !== batchFile.file_id))
      showToast('success', 'File deleted.')
    } catch (err) {
      console.error(err)
      showToast('error', getErrorMessage(err, 'Failed to delete file.'))
    }
  }

  function renderCreateDialog() {
    if (!isCreateOpen) return null

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
          onClick={closeCreateDialog}
          aria-hidden="true"
        />
        <div className="relative w-full max-w-lg rounded-xl bg-white shadow-2xl border border-slate-200 overflow-hidden max-h-[90vh] flex flex-col">
          <div className="bg-slate-50 px-4 py-3 border-b border-slate-200 flex items-center justify-between flex-shrink-0">
            <h3 className="text-base font-semibold text-slate-800">
              {modalTitle(createStep)}
            </h3>
            <button
              type="button"
              onClick={closeCreateDialog}
              disabled={isSubmitting}
              className="text-slate-400 hover:text-slate-600 p-1 rounded-md hover:bg-slate-200 disabled:opacity-60"
              aria-label="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="p-6 overflow-y-auto flex-1">
            {/* ── Step 1: Batch Details ── */}
            {createStep === 'details' && (
              <div className="space-y-4">
                <p className="text-sm text-slate-600">
                  Enter the batch details before adding students.
                </p>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Batch Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={batchDetails.batch_name}
                    onChange={(e) => setBatchDetails((d) => ({ ...d, batch_name: e.target.value }))}
                    placeholder="e.g., CS101 Group A"
                    className={INPUT_CLASS}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Course Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={batchDetails.course_name}
                    onChange={(e) => setBatchDetails((d) => ({ ...d, course_name: e.target.value }))}
                    placeholder="e.g., Introduction to Computer Science"
                    className={INPUT_CLASS}
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      Academic Year <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={batchDetails.academic_year}
                      onChange={(e) =>
                        setBatchDetails((d) => ({ ...d, academic_year: e.target.value }))
                      }
                      placeholder="e.g., 2025–2026"
                      className={INPUT_CLASS}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      Term <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={batchDetails.term}
                      onChange={(e) => setBatchDetails((d) => ({ ...d, term: e.target.value }))}
                      placeholder="e.g., Semester 1"
                      className={INPUT_CLASS}
                    />
                  </div>
                </div>

                <div className="flex justify-end pt-2">
                  <button
                    type="button"
                    className={BTN_PRIMARY}
                    disabled={!isDetailsComplete()}
                    onClick={() => setCreateStep('method')}
                  >
                    Next: Add Students
                  </button>
                </div>
              </div>
            )}

            {/* ── Step 2: Choose method ── */}
            {createStep === 'method' && (
              <div className="space-y-4">
                <p className="text-sm text-slate-600">
                  Choose how you&apos;d like to add students to this batch:
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    className="group relative flex flex-col items-center text-center p-4 border-2 border-slate-200 rounded-xl hover:border-emerald-500 hover:bg-emerald-50/20 transition-all focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-emerald-500"
                    onClick={() => setCreateStep('csv')}
                  >
                    <div className="w-10 h-10 rounded-lg bg-emerald-100 text-emerald-600 flex items-center justify-center group-hover:bg-emerald-200 transition-colors">
                      <Upload className="w-5 h-5" />
                    </div>
                    <div className="font-semibold text-slate-900 text-sm mt-3 mb-1">
                      Upload CSV File
                    </div>
                    <p className="text-xs text-slate-600 leading-relaxed">
                      Import multiple students from a CSV with name and email columns.
                    </p>
                  </button>

                  <button
                    type="button"
                    className="group relative flex flex-col items-center text-center p-4 border-2 border-slate-200 rounded-xl hover:border-green-500 hover:bg-green-50/20 transition-all focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500"
                    onClick={() => setCreateStep('manual')}
                  >
                    <div className="w-10 h-10 rounded-lg bg-green-100 text-green-600 flex items-center justify-center group-hover:bg-green-200 transition-colors">
                      <UserPlus className="w-5 h-5" />
                    </div>
                    <div className="font-semibold text-slate-900 text-sm mt-3 mb-1">
                      Add Manually
                    </div>
                    <p className="text-xs text-slate-600 leading-relaxed">
                      Enter each student&apos;s name and email one by one.
                    </p>
                  </button>
                </div>

                <div className="flex items-center justify-between pt-2">
                  <button
                    type="button"
                    className={BTN_BACK}
                    onClick={() => setCreateStep('details')}
                  >
                    <ArrowLeft className="w-4 h-4 mr-1" />
                    Back
                  </button>
                </div>
              </div>
            )}

            {/* ── Step 3a: CSV upload ── */}
            {createStep === 'csv' && (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">
                    Upload Students (CSV)
                  </label>
                  <label className="block cursor-pointer">
                    <input
                      type="file"
                      accept=".csv"
                      onChange={handleCsvFileSelect}
                      disabled={isSubmitting}
                      className="sr-only"
                    />
                    <div className="flex items-center gap-3 w-full rounded-md border border-slate-300 bg-slate-50 px-3 py-2.5 hover:bg-slate-100 transition-colors">
                      <span className="inline-flex items-center justify-center px-4 py-2 text-sm font-semibold rounded-md text-white bg-emerald-600 hover:bg-emerald-700 flex-shrink-0">
                        Choose File
                      </span>
                      <span
                        className={`text-sm truncate flex-1 ${csvFileName ? 'text-slate-900 font-medium' : 'text-slate-500'}`}
                      >
                        {csvFileName ?? 'No file chosen'}
                      </span>
                    </div>
                  </label>
                  <p className="text-xs text-slate-500 mt-2">
                    CSV must include columns{' '}
                    <span className="font-mono bg-slate-100 px-1 rounded text-slate-600">
                      name
                    </span>{' '}
                    and{' '}
                    <span className="font-mono bg-slate-100 px-1 rounded text-slate-600">
                      email
                    </span>
                    .
                  </p>
                </div>

                {csvError && <p className="text-xs font-medium text-red-600">{csvError}</p>}
                {createStatus && (
                  <p
                    className={`text-xs font-medium ${createStatus.includes('Creating') ? 'text-emerald-600 animate-pulse' : 'text-red-600'}`}
                  >
                    {createStatus}
                  </p>
                )}

                {csvStudents.length > 0 && (
                  <div className="max-h-40 overflow-y-auto border border-slate-200 rounded-lg">
                    <table className="min-w-full text-sm">
                      <thead>
                        <tr className="bg-slate-50">
                          <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600">
                            Name
                          </th>
                          <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600">
                            Email
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {csvStudents.map((s, idx) => (
                          <tr key={idx} className="border-t border-slate-100">
                            <td className="px-3 py-2 text-slate-900">{s.name}</td>
                            <td className="px-3 py-2 text-slate-600">{s.email}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <p className="px-3 py-2 text-xs text-green-600 font-medium border-t border-slate-100">
                      {csvStudents.length} student{csvStudents.length === 1 ? '' : 's'} ready
                    </p>
                  </div>
                )}

                <div className="flex items-center justify-between pt-4">
                  <button
                    type="button"
                    className={BTN_BACK}
                    onClick={() => setCreateStep('method')}
                    disabled={isSubmitting}
                  >
                    <ArrowLeft className="w-4 h-4 mr-1" />
                    Back
                  </button>
                  <div className="flex gap-3">
                    <button
                      type="button"
                      className={BTN_PRIMARY}
                      disabled={csvStudents.length === 0 || isSubmitting}
                      onClick={() => handleCreateWithStudents(csvStudents)}
                    >
                      {isSubmitting ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Creating…
                        </>
                      ) : (
                        'Create Batch'
                      )}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* ── Step 3b: Manual entry ── */}
            {createStep === 'manual' && (
              <div className="space-y-4">
                <div className="border-t border-slate-100 pt-2">
                  <label className="block text-sm font-medium text-slate-700 mb-3">
                    Add Students
                  </label>
                  <div className="grid grid-cols-[1fr_1fr_auto] gap-2 mb-2 items-center">
                    <input
                      type="text"
                      placeholder="Student name"
                      value={tempName}
                      onChange={(e) => setTempName(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddManualStudent())}
                      className="block w-full rounded-md border border-emerald-200 bg-slate-50 focus:bg-white focus:border-emerald-500 py-2.5 px-2 text-sm"
                    />
                    <input
                      type="email"
                      placeholder="Student email"
                      value={tempEmail}
                      onChange={(e) => setTempEmail(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddManualStudent())}
                      className="block w-full rounded-md border border-emerald-200 bg-slate-50 focus:bg-white focus:border-emerald-500 py-2.5 px-2 text-sm"
                    />
                    <button
                      type="button"
                      onClick={handleAddManualStudent}
                      className="inline-flex items-center justify-center w-8 h-8 rounded-full border border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 hover:border-emerald-400 shadow-sm transition-colors"
                      aria-label="Add student"
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="space-y-2">
                    {manualStudents.map((s, idx) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between gap-3 px-3 py-2 rounded border border-slate-200 bg-slate-50"
                      >
                        <div className="text-sm min-w-0">
                          <div className="font-medium text-slate-900 truncate">{s.name}</div>
                          <div className="text-xs text-slate-500 truncate">{s.email}</div>
                        </div>
                        <button
                          type="button"
                          className="inline-flex items-center px-2 py-1 border border-red-200 text-xs rounded-md text-red-600 bg-red-50 hover:bg-red-100 transition-colors flex-shrink-0"
                          onClick={() =>
                            setManualStudents((prev) => prev.filter((_, i) => i !== idx))
                          }
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>

                  <p
                    className={`text-xs mt-3 ${manualStudents.length > 0 ? 'text-green-600 font-medium' : 'text-slate-500'}`}
                  >
                    {manualStudents.length === 0
                      ? 'No students added yet.'
                      : `${manualStudents.length} student${manualStudents.length === 1 ? '' : 's'} added.`}
                  </p>
                </div>

                {createStatus && (
                  <p
                    className={`text-xs font-medium ${createStatus.includes('Creating') ? 'text-emerald-600 animate-pulse' : 'text-red-600'}`}
                  >
                    {createStatus}
                  </p>
                )}

                <div className="flex items-center justify-between pt-4">
                  <button
                    type="button"
                    className={BTN_BACK}
                    onClick={() => setCreateStep('method')}
                    disabled={isSubmitting}
                  >
                    <ArrowLeft className="w-4 h-4 mr-1" />
                    Back
                  </button>
                  <div className="flex gap-3">
                    <button
                      type="button"
                      className={BTN_PRIMARY}
                      disabled={manualStudents.length === 0 || isSubmitting}
                      onClick={() => handleCreateWithStudents(manualStudents)}
                    >
                      {isSubmitting ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Creating…
                        </>
                      ) : (
                        'Create Batch'
                      )}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  function statusBadge(status: IndexStatus) {
    const map: Record<IndexStatus, { label: string; icon: React.ReactNode; cls: string }> = {
      uploading: { label: 'Uploading', icon: <Loader2 className="w-3 h-3 animate-spin" />, cls: 'bg-sky-50 text-sky-700 border-sky-100' },
      indexing:  { label: 'Indexing',  icon: <Loader2 className="w-3 h-3 animate-spin" />, cls: 'bg-amber-50 text-amber-700 border-amber-100' },
      indexed:   { label: 'Indexed',   icon: <CheckCircle2 className="w-3 h-3" />,         cls: 'bg-emerald-50 text-emerald-700 border-emerald-100' },
      failed:    { label: 'Failed',    icon: <XCircle className="w-3 h-3" />,              cls: 'bg-red-50 text-red-700 border-red-100' },
      deleting:  { label: 'Deleting',  icon: <Loader2 className="w-3 h-3 animate-spin" />, cls: 'bg-slate-50 text-slate-500 border-slate-200' },
    }
    const { label, icon, cls } = map[status] ?? map.failed
    return (
      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${cls}`}>
        {icon}{label}
      </span>
    )
  }

  if (selectedBatch) {
    return (
      <div>
        <Toast toast={toast} onDismiss={() => setToast(null)} />

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div>
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl font-bold text-slate-800 tracking-tight">
                {selectedBatch.batch_name}
              </h1>
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-100">
                {students.length} student{students.length === 1 ? '' : 's'}
              </span>
            </div>
            <p className="text-sm text-slate-500 mt-1">
              {selectedBatch.course_name && (
                <span className="font-medium text-slate-700">{selectedBatch.course_name}</span>
              )}
              {selectedBatch.course_name && selectedBatch.academic_year && ' · '}
              {selectedBatch.academic_year}
              {selectedBatch.term && ` · ${selectedBatch.term}`}
              {selectedBatch.createdAt && (
                <> · Created {formatDate(selectedBatch.createdAt)}</>
              )}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => setSelectedBatch(null)} className={BTN_SECONDARY}>
              <ArrowLeft className="w-4 h-4 mr-1" />
              Back
            </button>
            <button
              type="button"
              onClick={() => handleDeleteBatch(selectedBatch)}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-md border border-red-200 text-red-700 bg-white hover:bg-red-50 transition-colors"
            >
              <Trash2 className="w-4 h-4" />
              Delete Batch
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-6 border-b border-slate-200">
          <button
            type="button"
            onClick={() => setDetailTab('students')}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              detailTab === 'students'
                ? 'border-emerald-600 text-emerald-700'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            <Users className="w-4 h-4" />
            Students
          </button>
          <button
            type="button"
            onClick={() => setDetailTab('materials')}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              detailTab === 'materials'
                ? 'border-emerald-600 text-emerald-700'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            <BookOpen className="w-4 h-4" />
            Course Materials
            {files.length > 0 && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-xs bg-slate-100 text-slate-600">
                {files.length}
              </span>
            )}
          </button>
        </div>

        {/* ── Students Tab ── */}
        {detailTab === 'students' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-1 space-y-5">
              <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5">
                <h2 className="text-sm font-semibold text-slate-800 mb-4 flex items-center gap-2">
                  <UserPlus className="w-4 h-4 text-emerald-600" />
                  Add student
                </h2>
                <form onSubmit={handleAddStudent} className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Name</label>
                    <input
                      type="text"
                      required
                      value={studentForm.name}
                      onChange={(e) => setStudentForm((f) => ({ ...f, name: e.target.value }))}
                      placeholder="e.g. Jane Smith"
                      className="block w-full rounded-md border border-slate-300 shadow-sm py-2 px-3 text-sm focus:border-emerald-500 focus:ring-emerald-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Email</label>
                    <input
                      type="email"
                      required
                      value={studentForm.email}
                      onChange={(e) => setStudentForm((f) => ({ ...f, email: e.target.value }))}
                      placeholder="e.g. jane@school.edu"
                      className="block w-full rounded-md border border-slate-300 shadow-sm py-2 px-3 text-sm focus:border-emerald-500 focus:ring-emerald-500"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={addingStudent}
                    className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium rounded-md text-white bg-emerald-600 hover:bg-emerald-700 shadow-sm disabled:opacity-70"
                  >
                    {addingStudent ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                    Add student
                  </button>
                </form>
              </div>

              <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5">
                <h2 className="text-sm font-semibold text-slate-800 mb-2 flex items-center gap-2">
                  <Upload className="w-4 h-4 text-emerald-600" />
                  Bulk import (CSV)
                </h2>
                <p className="text-xs text-slate-500 mb-3">
                  Upload a CSV with <code className="text-slate-700">name</code> and{' '}
                  <code className="text-slate-700">email</code> columns.
                </p>
                <label className="relative inline-flex w-full cursor-pointer">
                  <input type="file" accept=".csv" onChange={handleCsvUpload} disabled={csvUploading} className="sr-only" />
                  <span className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium rounded-md border border-slate-300 text-slate-700 bg-white hover:bg-slate-50 transition-colors disabled:opacity-70">
                    {csvUploading ? (
                      <><Loader2 className="w-4 h-4 animate-spin" />Importing…</>
                    ) : (
                      <><Upload className="w-4 h-4" />Choose CSV file</>
                    )}
                  </span>
                </label>
              </div>
            </div>

            <div className="lg:col-span-2 bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
              {studentsLoading ? (
                <div className="flex flex-col items-center justify-center py-20 gap-3">
                  <Loader2 className="w-8 h-8 text-emerald-600 animate-spin" />
                  <p className="text-sm text-slate-500">Loading students…</p>
                </div>
              ) : students.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center px-6">
                  <Users className="w-8 h-8 text-slate-300 mb-2" />
                  <span className="text-sm font-medium text-slate-500">No students in this batch yet.</span>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-slate-100">
                    <thead className="bg-slate-50/90">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Name</th>
                        <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Email</th>
                        <th className="relative px-6 py-3"><span className="sr-only">Actions</span></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {students.map((student) => (
                        <tr key={student.id} className="group hover:bg-slate-50/90 transition-colors">
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm font-medium text-slate-900 group-hover:text-emerald-600 transition-colors">{student.name}</div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-500">{student.email}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                            <button
                              type="button"
                              onClick={() => handleRemoveStudent(student)}
                              className="inline-flex items-center px-3 py-1.5 border border-slate-300 shadow-sm text-xs font-medium rounded-md text-slate-700 bg-white hover:bg-red-50 hover:text-red-600 hover:border-red-200 transition-all"
                            >
                              <Trash2 className="w-3 h-3 mr-1.5" />
                              Remove
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Course Materials Tab ── */}
        {detailTab === 'materials' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-slate-500">
                Upload course materials — PDFs, documents, and text files are indexed for AI search.
              </p>
              <div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.txt,.md,.docx,.json"
                  onChange={handleFileUpload}
                  disabled={fileUploading}
                  className="sr-only"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={fileUploading}
                  className={BTN_PRIMARY}
                >
                  {fileUploading ? (
                    <><Loader2 className="w-4 h-4 animate-spin" />Uploading…</>
                  ) : (
                    <><Upload className="w-4 h-4" />Upload File</>
                  )}
                </button>
              </div>
            </div>

            <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
              {filesLoading && files.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 gap-3">
                  <Loader2 className="w-8 h-8 text-emerald-600 animate-spin" />
                  <p className="text-sm text-slate-500">Loading files…</p>
                </div>
              ) : files.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center px-6">
                  <FileText className="w-8 h-8 text-slate-300 mb-2" />
                  <span className="text-sm font-medium text-slate-500">No course materials uploaded yet.</span>
                  <p className="text-xs text-slate-400 mt-1">
                    Upload PDFs, Word docs, or text files to make them searchable by the AI assistant.
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-slate-100">
                    <thead className="bg-slate-50/90">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">File</th>
                        <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Status</th>
                        <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Uploaded</th>
                        <th className="relative px-6 py-3"><span className="sr-only">Actions</span></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {files.map((f) => (
                        <tr key={f.file_id} className="group hover:bg-slate-50/90 transition-colors">
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-2">
                              <FileText className="w-4 h-4 text-slate-400 flex-shrink-0" />
                              <div className="min-w-0">
                                <div className="text-sm font-medium text-slate-900 truncate max-w-[260px]" title={f.file_name}>
                                  {f.file_title || f.file_name}
                                </div>
                                {f.file_title !== f.file_name && (
                                  <div className="text-xs text-slate-400 truncate max-w-[260px]">{f.file_name}</div>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="space-y-1">
                              {statusBadge(f.index_status)}
                              {f.index_status === 'failed' && f.index_error && (
                                <p className="text-xs text-red-500 max-w-[220px] truncate" title={f.index_error}>
                                  {f.index_error}
                                </p>
                              )}
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-500">
                            {f.created_at ? (
                              <span className="flex items-center gap-1">
                                <Clock className="w-3 h-3" />
                                {formatDate(new Date(f.created_at))}
                              </span>
                            ) : '—'}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                            <button
                              type="button"
                              onClick={() => handleDeleteFile(f)}
                              disabled={f.index_status === 'deleting'}
                              className="inline-flex items-center px-3 py-1.5 border border-slate-300 shadow-sm text-xs font-medium rounded-md text-slate-700 bg-white hover:bg-red-50 hover:text-red-600 hover:border-red-200 disabled:opacity-50 transition-all"
                            >
                              <Trash2 className="w-3 h-3 mr-1.5" />
                              Delete
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div>
      <Toast toast={toast} onDismiss={() => setToast(null)} />
      {renderCreateDialog()}

      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800 tracking-tight">Batches</h1>
        <p className="text-sm text-slate-500 mt-1">
          Manage your student groups and course rosters.
        </p>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search batches…"
            className="block w-full h-11 rounded-md border border-slate-300 bg-white shadow-sm pl-10 pr-10 text-sm text-slate-900 placeholder:text-slate-400 focus:border-emerald-500 focus:ring-emerald-500 focus:outline-none focus:ring-1"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              aria-label="Clear search"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={openCreateDialog}
          className="inline-flex items-center justify-center h-11 px-5 border border-transparent text-sm font-medium rounded-md text-white bg-emerald-600 hover:bg-emerald-700 shadow-sm transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-emerald-500 sm:flex-shrink-0 sm:min-w-[180px]"
        >
          <Plus className="w-5 h-5 mr-2 -ml-1" />
          Create New Batch
        </button>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden transition-shadow duration-200 hover:shadow-md">
        {listLoading ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <Loader2 className="w-8 h-8 text-emerald-600 animate-spin" />
            <p className="text-sm text-slate-500">Loading batches…</p>
          </div>
        ) : listError ? (
          <div className="flex flex-col items-center justify-center py-16 px-6 text-center gap-2">
            <p className="text-sm font-medium text-red-700">{listError}</p>
          </div>
        ) : batches.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="h-16 w-16 bg-slate-50 rounded-full flex items-center justify-center mb-4">
              <Users className="w-8 h-8 text-slate-300" />
            </div>
            <h3 className="text-sm font-medium text-slate-900">No batches created</h3>
            <p className="mt-1 text-sm text-slate-500 mb-6">
              Get started by creating a new batch.
            </p>
            <button
              type="button"
              onClick={openCreateDialog}
              className={`${BTN_PRIMARY} px-6 py-3 min-h-[48px]`}
            >
              <Plus className="w-4 h-4" />
              Create Batch
            </button>
          </div>
        ) : filteredBatches.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center px-6">
            <Search className="w-8 h-8 text-slate-300 mb-3" />
            <h3 className="text-sm font-medium text-slate-900">No matching batches</h3>
            <p className="mt-1 text-sm text-slate-500">
              No batches match &ldquo;{searchQuery}&rdquo;. Try a different search.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-100">
              <thead className="bg-slate-50/90">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    Batch
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    Course
                  </th>
                  <th className="px-6 py-3 text-center text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    Students
                  </th>
                  <th className="relative px-6 py-3">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredBatches.map((batch) => (
                  <tr key={batch.id} className="group transition-all duration-150 hover:bg-slate-50/80">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <div className="flex-shrink-0 h-8 w-8 rounded bg-emerald-50 text-emerald-600 flex items-center justify-center mr-3 border border-emerald-100 group-hover:shadow-sm transition-shadow">
                          <Users className="w-4 h-4" />
                        </div>
                        <div>
                          <div className="text-sm font-medium text-slate-900 group-hover:text-emerald-600 transition-colors">
                            {batch.batch_name || 'Untitled Batch'}
                          </div>
                          {batch.academic_year && (
                            <div className="text-xs text-slate-500">
                              {batch.academic_year}{batch.term ? ` · ${batch.term}` : ''}
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="text-sm text-slate-600">{batch.course_name || '—'}</span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-center">
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-800 group-hover:bg-emerald-50 group-hover:text-emerald-700 transition-colors">
                        {batch.student_count} student{batch.student_count === 1 ? '' : 's'}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setSelectedBatch(batch)}
                          className="inline-flex items-center px-3 py-1.5 border border-slate-300 shadow-sm text-xs font-medium rounded-md text-slate-700 bg-white hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-emerald-500 transition-all"
                        >
                          <Eye className="w-3 h-3 mr-1.5 text-slate-500" />
                          View Students
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteBatch(batch)}
                          className="inline-flex items-center px-3 py-1.5 border border-red-300 shadow-sm text-xs font-medium rounded-md text-red-700 bg-white hover:bg-red-50 focus:outline-none transition-all"
                        >
                          <Trash2 className="w-3 h-3 mr-1.5 text-red-500" />
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
