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
import { deleteGame, listGames, type GameSession } from '../../../services/gameService'
import type { BatchDetails, BatchWithCount, CreateStep, DetailTab, StudentRow } from '../types'
import { parseCsv } from '../utils/parseCsv'
import { confirm } from '../../../components/ui/confirmStore'
import { undoable, usePendingUndo } from '../../../components/ui/undoStore'

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
  const hydratedFromUrlRef = useRef(false)
  // Tab asked for by the URL. Applied by the selection effect further down rather
  // than here, because that effect resets the tab to 'students' for every newly
  // selected batch and would otherwise clobber it.
  const pendingTabRef = useRef<DetailTab | null>(null)

  // `?batch=<id>&tab=<tab>` is the source of truth for which batch is open. Keeping
  // it in the URL (rather than only in state) is what lets browser Back from a chat
  // land on that batch's tab instead of the batch list, and lets a refresh or a
  // shared link restore the same view.
  useEffect(() => {
    if (hydratedFromUrlRef.current || batches.length === 0) return
    hydratedFromUrlRef.current = true
    const batchParam = searchParams.get('batch')
    if (!batchParam) return
    const match = batches.find((b) => b.id === batchParam)
    if (!match) return
    const tabParam = searchParams.get('tab') as DetailTab | null
    if (tabParam) pendingTabRef.current = tabParam
    setSelectedBatch(match)
  }, [searchParams, batches])

  // Mirror the current selection back into the query string. `replace` on purpose:
  // opening a batch or switching tabs should not each add a history entry — we want
  // exactly one entry for "the batches page, on this batch/tab".
  useEffect(() => {
    if (!hydratedFromUrlRef.current) return
    const next = new URLSearchParams(searchParams)
    if (selectedBatch) {
      next.set('batch', selectedBatch.id)
      next.set('tab', detailTab)
    } else {
      next.delete('batch')
      next.delete('tab')
    }
    if (next.toString() === searchParams.toString()) return
    setSearchParams(next, { replace: true })
  }, [selectedBatch, detailTab, searchParams, setSearchParams])
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
  /* Games are not artifacts. They live in their own `gameSessions` collection
     with their own id, no version chain and no Drive file, so they arrive from
     a second call rather than out of `listArtifacts`. The Generated content tab
     normalises the two into one row shape. */
  const [games, setGames] = useState<GameSession[]>([])
  const pendingUndo = usePendingUndo()
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
      const [items, summary, gameList] = await Promise.all([
        listArtifacts(selectedBatch.id),
        getArtifactSummary(selectedBatch.id),
        // Best-effort: a space with no games 404s on nothing, but a games
        // outage should not blank the artifacts the lecturer came for.
        listGames(selectedBatch.id).catch(() => [] as GameSession[]),
      ])
      setArtifacts(items)
      setArtifactSummary(summary)
      setGames(gameList)
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
      setGames([])
      setArtifactSummary(null)
      if (pollingRef.current) clearInterval(pollingRef.current)
      lastDetailBatchIdRef.current = null
      return
    }
    // Metadata edits replace the selectedBatch object but keep the same id —
    // don't yank the user back to the Students tab or refetch everything.
    if (lastDetailBatchIdRef.current === selectedBatch.id) return
    lastDetailBatchIdRef.current = selectedBatch.id
    // A URL-requested tab wins over the default for this one selection.
    setDetailTab(pendingTabRef.current ?? 'students')
    pendingTabRef.current = null
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

  /* One of only two places in the app that makes you type the name. A batch is
     the top-level workspace — deleting it takes every student, file, artifact
     and chat under it — and ten seconds of undo is not a proportionate safety
     net for something that large. */
  async function handleDeleteBatch(batch: Batch) {
    const ok = await confirm({
      title: `Delete "${batch.batch_name}"?`,
      body: 'This deletes the batch and every student in it. It cannot be undone.',
      confirmPhrase: batch.batch_name,
      confirmLabel: 'Delete batch',
      tone: 'danger',
    })
    if (!ok) return

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

  function handleRemoveStudent(student: BatchStudent) {
    const batch = selectedBatch
    if (!batch) return
    undoable({
      id: student.id,
      message: `Removed ${student.name}.`,
      commit: async () => {
        try {
          await removeStudentFromBatch(batch.id, student.id)
          await refreshStudents()
        } catch (err) {
          console.error(err)
          showToast('error', getErrorMessage(err, 'Failed to remove student.'))
          /* The row is already back — `usePendingUndo` stopped hiding it the
             moment the window closed — so this only has to say what went
             wrong, not restore anything. */
          await refreshStudents()
        }
      },
    })
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

  function handleDeleteFile(batchFile: BatchFile) {
    const batch = selectedBatch
    if (!batch) return
    undoable({
      id: batchFile.file_id,
      message: `Deleted "${batchFile.file_name}".`,
      commit: async () => {
        try {
          await deleteBatchFile(batch.id, batchFile.file_id)
          setFiles((prev) => prev.filter((f) => f.file_id !== batchFile.file_id))
        } catch (err) {
          console.error(err)
          showToast('error', getErrorMessage(err, 'Failed to delete file.'))
        }
      },
    })
  }

  /** A deadline change or a close/reopen, applied in place. */
  function handleGameUpdated(updated: GameSession) {
    setGames((prev) => prev.map((game) => (game.gameId === updated.gameId ? updated : game)))
  }

  /* Games sit beside the Drive-backed artifacts in Generated content and are
     just as gone once deleted — a student holding the link loses it — so they
     ask the same way, and get the same ten seconds after. */
  async function handleDeleteGame(game: GameSession) {
    const batch = selectedBatch
    if (!batch) return
    const ok = await confirm({
      title: `Delete "${game.title}"?`,
      body: 'Students holding the link will no longer be able to play it.',
      confirmLabel: 'Delete',
      tone: 'danger',
    })
    if (!ok) return
    undoable({
      id: game.gameId,
      message: `Deleted "${game.title}".`,
      commit: async () => {
        try {
          await deleteGame(batch.id, game.gameId)
          await refreshArtifacts()
        } catch (err) {
          console.error(err)
          showToast('error', getErrorMessage(err, 'Could not delete that game.'))
        }
      },
    })
  }

  async function handleDeleteArtifact(artifact: Artifact) {
    const batch = selectedBatch
    if (!batch) return
    const metadata = artifact.metadata || {}
    const label =
      artifact.drive_file_name ||
      `v${String(artifact.version || 1).padStart(2, '0')} - ${
        artifact.week ? `Week ${String(artifact.week).padStart(2, '0')} - ` : ''
      }${artifact.title}`
    const labNote =
      artifact.type === 'lab' ? ' Both the Lecturer Guide and the Student Instructions go.' : ''
    /* Ask, then hold. This one reaches outside MILA — the Drive file goes with
       it — so it is worth a beat of thought first; but the ten seconds after
       are worth more than making anyone type, because they catch the click on
       the wrong row, which is the mistake that actually happens. */
    const ok = await confirm({
      title: `Delete ${label}?`,
      body: `This removes it from MILA and deletes the Google Drive file.${labNote}`,
      confirmLabel: 'Delete',
      tone: 'danger',
    })
    if (!ok) return

    undoable({
      id: artifact.id,
      message: metadata.student_doc_id
        ? 'Deleted, along with its linked Drive files.'
        : `Deleted ${label}.`,
      commit: async () => {
        try {
          await deleteArtifact(batch.id, artifact.id, true)
          await refreshArtifacts()
        } catch (err) {
          console.error(err)
          showToast(
            'error',
            getErrorMessage(err, 'Could not delete it. Reconnect Google Workspace if Drive deletion failed.'),
          )
        }
      },
    })
  }

  return {
    toast,
    setToast,
    selectedBatch,
    setSelectedBatch,
    detailTab,
    setDetailTab,
    /* Filtered here, at the boundary, rather than in each tab — and
       deliberately not where the lists are used internally: the stuck-file
       sweep above still has to see a file that is mid-undo, because it has not
       actually been deleted yet. */
    students: students.filter((student) => !pendingUndo.has(student.id)),
    studentsLoading,
    files: files.filter((file) => !pendingUndo.has(file.file_id)),
    filesLoading,
    artifacts: artifacts.filter((artifact) => !pendingUndo.has(artifact.id)),
    games: games.filter((game) => !pendingUndo.has(game.gameId)),
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
    handleDeleteGame,
    handleGameUpdated,
    refreshArtifacts,
  }
}

export type BatchesPageState = ReturnType<typeof useBatchesPage>
