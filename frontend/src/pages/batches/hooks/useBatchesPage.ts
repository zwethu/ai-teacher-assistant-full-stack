import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { ToastMessage } from '../../../types'
import type { Batch, BatchStudent } from '../../../entity/Batch'
import type { BatchFile, IndexStatus } from '../../../entity/File'
import { getErrorMessage } from '../../../utils/errors'
import { useAuth } from '../../../hooks/useAuth'
import {
  deleteArtifact,
  getArtifactSummary,
  listArtifacts,
  type Artifact,
  type ArtifactSummary,
} from '../../../services/artifactService'
import {
  addStudentToBatch,
  createBatch,
  deleteBatch,
  listBatches,
  listBatchStudents,
  removeStudentFromBatch,
  updateBatch,
} from '../../../services/batchService'
import {
  deleteBatchFile,
  listBatchFiles,
  syncBatchFileIndexStatus,
  uploadBatchFile,
} from '../../../services/fileService'
import type { BatchDetails, BatchWithCount, CreateStep, DetailTab, StudentRow } from '../types'
import { parseCsv } from '../utils/parseCsv'

export function useBatchesPage() {
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

  const [isEditOpen, setIsEditOpen] = useState(false)
  const [editDetails, setEditDetails] = useState<BatchDetails>({
    batch_name: '',
    course_name: '',
    academic_year: '',
    term: '',
  })
  const [isSavingEdit, setIsSavingEdit] = useState(false)
  const [searchParams, setSearchParams] = useSearchParams()

  // Deep link support: /batches?batch=<id>&tab=planning opens a batch straight
  // to a tab (e.g. from the "create a Course Plan" hint on the standalone pages).
  useEffect(() => {
    const batchParam = searchParams.get('batch')
    if (!batchParam || selectedBatch || batches.length === 0) return
    const match = batches.find((b) => b.id === batchParam)
    if (!match) return
    setSelectedBatch(match)
    const tabParam = searchParams.get('tab') as DetailTab | null
    if (tabParam) setDetailTab(tabParam)
    setSearchParams({}, { replace: true })
  }, [searchParams, batches, selectedBatch, setSearchParams])
  const [students, setStudents] = useState<BatchStudent[]>([])
  const [studentsLoading, setStudentsLoading] = useState(false)
  const lastDetailBatchIdRef = useRef<string | null>(null)

  const [studentForm, setStudentForm] = useState({ name: '', email: '' })
  const [addingStudent, setAddingStudent] = useState(false)
  const [csvUploading, setCsvUploading] = useState(false)

  const [files, setFiles] = useState<BatchFile[]>([])
  const [filesLoading, setFilesLoading] = useState(false)
  const [fileUploading, setFileUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [artifacts, setArtifacts] = useState<Artifact[]>([])
  const [artifactSummary, setArtifactSummary] = useState<ArtifactSummary | null>(null)
  const [artifactsLoading, setArtifactsLoading] = useState(false)

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

  const refreshFiles = useCallback(async (options?: { silent?: boolean }) => {
    if (!selectedBatch) return
    if (!options?.silent) setFilesLoading(true)
    try {
      const data = await listBatchFiles(selectedBatch.id)
      setFiles(data)
    } catch (err) {
      console.error(err)
      if (!options?.silent) {
        showToast('error', getErrorMessage(err, 'Could not load files.'))
      }
    } finally {
      if (!options?.silent) setFilesLoading(false)
    }
  }, [selectedBatch]) // eslint-disable-line react-hooks/exhaustive-deps

  const refreshArtifacts = useCallback(async () => {
    if (!selectedBatch) return
    setArtifactsLoading(true)
    try {
      const [items, summary] = await Promise.all([
        listArtifacts(selectedBatch.id),
        getArtifactSummary(selectedBatch.id),
      ])
      setArtifacts(items)
      setArtifactSummary(summary)
    } catch (err) {
      console.error(err)
      showToast('error', getErrorMessage(err, 'Could not load generated content.'))
    } finally {
      setArtifactsLoading(false)
    }
  }, [selectedBatch]) // eslint-disable-line react-hooks/exhaustive-deps

  const syncStuckFiles = useCallback(async () => {
    if (!selectedBatch) return
    const now = Date.now()
    const transitional: IndexStatus[] = ['uploading', 'pending', 'indexing', 'deleting']
    const stuck = files.filter((file) => {
      if (!transitional.includes(file.index_status) && file.overlay_status !== 'retiring') return false
      const timestamp = file.updated_at || file.created_at
      if (!timestamp) return true
      return now - new Date(timestamp).getTime() > 60_000
    })
    if (stuck.length === 0) return

    const synced = await Promise.all(
      stuck.map((file) =>
        syncBatchFileIndexStatus(selectedBatch.id, file.file_id).catch((err) => {
          console.error(err)
          return null
        }),
      ),
    )
    const updates = synced.filter(Boolean) as BatchFile[]
    if (updates.length === 0) return
    setFiles((prev) =>
      prev.map((file) => updates.find((updated) => updated.file_id === file.file_id) ?? file),
    )
  }, [files, selectedBatch])

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
      setArtifacts([])
      setArtifactSummary(null)
      if (pollingRef.current) clearInterval(pollingRef.current)
      lastDetailBatchIdRef.current = null
      return
    }
    // Metadata edits replace the selectedBatch object but keep the same id —
    // don't yank the user back to the Students tab or refetch everything.
    if (lastDetailBatchIdRef.current === selectedBatch.id) return
    lastDetailBatchIdRef.current = selectedBatch.id
    setDetailTab('students')
    refreshStudents()
    refreshFiles()
    refreshArtifacts()
  }, [selectedBatch, refreshStudents, refreshFiles, refreshArtifacts])

  useEffect(() => {
    if (pollingRef.current) clearInterval(pollingRef.current)
    const transitional: IndexStatus[] = ['uploading', 'pending', 'indexing', 'deleting']
    const needsPolling = files.some((f) => transitional.includes(f.index_status) || f.overlay_status === 'retiring')
    if (!needsPolling || !selectedBatch) return
    pollingRef.current = setInterval(() => {
      void refreshFiles({ silent: true })
      void syncStuckFiles()
    }, 4000)
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current)
    }
  }, [files, selectedBatch, refreshFiles, syncStuckFiles])

  async function handleRefreshFiles() {
    await refreshFiles()
    await syncStuckFiles()
  }

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
      await createBatch({
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

  function openEditDialog() {
    if (!selectedBatch) return
    setEditDetails({
      batch_name: selectedBatch.batch_name,
      course_name: selectedBatch.course_name,
      academic_year: selectedBatch.academic_year,
      term: selectedBatch.term,
    })
    setIsEditOpen(true)
  }

  function closeEditDialog() {
    if (isSavingEdit) return
    setIsEditOpen(false)
  }

  async function handleSaveBatchDetails() {
    if (!selectedBatch) return
    if (!editDetails.batch_name.trim()) {
      showToast('error', 'Batch name cannot be empty.')
      return
    }

    setIsSavingEdit(true)
    try {
      const updated = await updateBatch(selectedBatch.id, {
        batch_name: editDetails.batch_name.trim(),
        course_name: editDetails.course_name.trim(),
        academic_year: editDetails.academic_year.trim(),
        term: editDetails.term.trim(),
      })
      setSelectedBatch(updated)
      setBatches((prev) => prev.map((b) => (b.id === updated.id ? updated : b)))
      setIsEditOpen(false)
      showToast('success', 'Batch details updated.')
    } catch (err) {
      console.error(err)
      showToast('error', getErrorMessage(err, 'Failed to update batch.'))
    } finally {
      setIsSavingEdit(false)
    }
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
      setFiles((prev) => [
        { ...uploaded, index_message: uploaded.index_message || 'Starting document import…' },
        ...prev,
      ])
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
    if (
      !window.confirm(
        `Delete "${batchFile.file_name}"? This will also remove it from the search index.`,
      )
    ) {
      return
    }

    try {
      await deleteBatchFile(selectedBatch.id, batchFile.file_id)
      setFiles((prev) => prev.filter((f) => f.file_id !== batchFile.file_id))
      showToast('success', 'File deleted.')
    } catch (err) {
      console.error(err)
      showToast('error', getErrorMessage(err, 'Failed to delete file.'))
    }
  }

  async function handleDeleteArtifact(artifact: Artifact) {
    if (!selectedBatch) return
    const metadata = artifact.metadata || {}
    const label =
      artifact.drive_file_name ||
      `v${String(artifact.version || 1).padStart(2, '0')} - ${
        artifact.week ? `Week ${String(artifact.week).padStart(2, '0')} - ` : ''
      }${artifact.title}`
    const labNote = artifact.type === 'lab' ? '\n\nThis will delete both Lecturer Guide and Student Instructions.' : ''
    if (
      !window.confirm(
        `Delete ${label}?\n\nThis removes it from MILA and permanently deletes the Google Drive file. This cannot be undone.${labNote}`,
      )
    ) {
      return
    }

    try {
      await deleteArtifact(selectedBatch.id, artifact.id, true)
      await refreshArtifacts()
      showToast(
        'success',
        metadata.student_doc_id ? 'Deleted, along with its linked Drive files.' : 'Deleted.',
      )
    } catch (err) {
      console.error(err)
      showToast('error', getErrorMessage(err, 'Could not delete it. Reconnect Google Workspace if Drive deletion failed.'))
    }
  }

  return {
    toast,
    setToast,
    selectedBatch,
    setSelectedBatch,
    detailTab,
    setDetailTab,
    students,
    studentsLoading,
    files,
    filesLoading,
    artifacts,
    artifactSummary,
    artifactsLoading,
    fileUploading,
    fileInputRef,
    isCreateOpen,
    createStep,
    setCreateStep,
    batchDetails,
    setBatchDetails,
    manualStudents,
    setManualStudents,
    csvStudents,
    csvFileName,
    tempName,
    setTempName,
    tempEmail,
    setTempEmail,
    isSubmitting,
    csvError,
    createStatus,
    studentForm,
    setStudentForm,
    addingStudent,
    csvUploading,
    searchQuery,
    setSearchQuery,
    filteredBatches,
    batches,
    listLoading,
    listError,
    isEditOpen,
    editDetails,
    setEditDetails,
    isSavingEdit,
    openEditDialog,
    closeEditDialog,
    handleSaveBatchDetails,
    openCreateDialog,
    closeCreateDialog,
    isDetailsComplete,
    handleCreateWithStudents,
    handleAddManualStudent,
    handleCsvFileSelect,
    handleDeleteBatch,
    handleAddStudent,
    handleRemoveStudent,
    handleCsvUpload,
    handleFileUpload,
    handleDeleteFile,
    handleRefreshFiles,
    handleDeleteArtifact,
    refreshArtifacts,
  }
}

export type BatchesPageState = ReturnType<typeof useBatchesPage>
