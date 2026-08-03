import { useEffect, useState } from 'react'
import { BatchTabs } from './BatchTabs'
import type { Batch } from '../../../entity/Batch'
import type { BatchStudent } from '../../../entity/Batch'
import type { BatchFile } from '../../../entity/File'
import Toast from '../../../components/ui/Toast'
import type { ToastMessage } from '../../../types'
import {
  getCurrentCourseBlueprint,
  type CourseBlueprint,
} from '../../../services/courseBlueprintService'
import { formatDate } from '../../../utils/formatDate'

/** Must match `.mila-tabpanel[data-leaving]`'s duration in index.css. */
const TAB_FADE_OUT_MS = 100
import {
  ArrowLeft,
  BookOpenCheck,
  MessageCircle,
  Pencil,
  Sparkles,
  Trash2,
  Users,
} from 'lucide-react'
import { BTN_SECONDARY } from '../constants'
import type { BatchDetails, DetailTab } from '../types'
import { ArtifactsTab } from './ArtifactsTab'
import { EditBatchDialog } from './EditBatchDialog'
import { MaterialsTab } from './MaterialsTab'
import { StudentsTab } from './StudentsTab'
import type { Artifact, ArtifactSummary } from '../../../services/artifactService'
import type { GameSession } from '../../../services/gameService'
import { PlanningTab } from './PlanningTab'

type Props = {
  toast: ToastMessage | null
  setToast: (toast: ToastMessage | null) => void
  selectedBatch: Batch
  setSelectedBatch: (batch: Batch | null) => void
  detailTab: DetailTab
  setDetailTab: (tab: DetailTab) => void
  students: BatchStudent[]
  studentsLoading: boolean
  files: BatchFile[]
  filesLoading: boolean
  artifacts: Artifact[]
  games: GameSession[]
  artifactSummary: ArtifactSummary | null
  artifactsLoading: boolean
  fileUploading: boolean
  fileInputRef: React.RefObject<HTMLInputElement | null>
  studentForm: { name: string; email: string }
  setStudentForm: React.Dispatch<React.SetStateAction<{ name: string; email: string }>>
  addingStudent: boolean
  csvUploading: boolean
  handleDeleteBatch: (batch: Batch) => void
  handleAddStudent: (e: React.FormEvent) => void
  handleRemoveStudent: (student: BatchStudent) => void
  handleCsvUpload: (e: React.ChangeEvent<HTMLInputElement>) => void
  handleFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void
  handleDeleteFile: (file: BatchFile) => void
  handleRefreshFiles: () => void
  handleDeleteArtifact: (artifact: Artifact) => void
  handleDeleteGame: (game: GameSession) => void
  handleGameUpdated: (game: GameSession) => void
  refreshArtifacts: () => void
  isEditOpen: boolean
  editDetails: BatchDetails
  setEditDetails: React.Dispatch<React.SetStateAction<BatchDetails>>
  isSavingEdit: boolean
  openEditDialog: () => void
  closeEditDialog: () => void
  handleSaveBatchDetails: () => Promise<void>
}

export function BatchDetailView({
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
  games,
  artifactSummary,
  artifactsLoading,
  fileUploading,
  fileInputRef,
  studentForm,
  setStudentForm,
  addingStudent,
  csvUploading,
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
  isEditOpen,
  editDetails,
  setEditDetails,
  isSavingEdit,
  openEditDialog,
  closeEditDialog,
  handleSaveBatchDetails,
}: Props) {
  /* Sessions fills the viewport; the others size to their content.
     ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄
     Not a reversal of removing it. The original defect was a *card* pinned to
     `h-full` — a panel holding two rows of chat stretched to the whole screen.
     What needs the height is the column, so the floating composer has a foot
     to sit at; the card inside it still sizes to its rows. */
  /* The panel lags the bar by one fade.
     The indicator and the tab's own colour respond on the click — that is the
     feedback for the press. The panel underneath fades out first, swaps while
     nothing is visible, then fades in, so the two panels are never on screen
     at once: one of these tabs fetches a chat list on mount, and a true
     crossfade would fire that behind a panel already on its way out. */
  const [shownTab, setShownTab] = useState(detailTab)
  const [tabLeaving, setTabLeaving] = useState(false)

  useEffect(() => {
    if (detailTab === shownTab) return undefined
    setTabLeaving(true)
    const timer = setTimeout(() => {
      setShownTab(detailTab)
      setTabLeaving(false)
    }, TAB_FADE_OUT_MS)
    return () => clearTimeout(timer)
  }, [detailTab, shownTab])

  const [blueprint, setBlueprint] = useState<CourseBlueprint | null>(null)
  useEffect(() => {
    let cancelled = false
    void getCurrentCourseBlueprint(selectedBatch.id)
      .then((value) => !cancelled && setBlueprint(value))
      .catch(() => !cancelled && setBlueprint(null))
    return () => {
      cancelled = true
    }
  }, [selectedBatch.id])

  return (
    <div
      className={
        shownTab === 'materials' ? 'flex h-full min-h-0 flex-col overflow-hidden' : 'pb-8'
      }
    >
      <Toast toast={toast} onDismiss={() => setToast(null)} />
      <EditBatchDialog
        isEditOpen={isEditOpen}
        editDetails={editDetails}
        setEditDetails={setEditDetails}
        isSavingEdit={isSavingEdit}
        closeEditDialog={closeEditDialog}
        handleSaveBatchDetails={handleSaveBatchDetails}
      />

      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold text-slate-800 tracking-tight">
              {selectedBatch.batch_name}
            </h1>
            <button
              type="button"
              onClick={openEditDialog}
              className="p-1.5 rounded-md text-slate-400 hover:text-violet-700 hover:bg-violet-50 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
              aria-label="Edit batch details"
              title="Edit batch details"
            >
              <Pencil className="w-4 h-4" />
            </button>
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-violet-50 text-violet-700 border border-violet-100">
              {students.length} student{students.length === 1 ? '' : 's'}
            </span>
            {/* The blueprint's facts, beside the other facts about this batch.
                They used to be a 190px tinted card in the Sessions rail whose
                only action was to switch to the Planning tab — the first tab
                in the strip directly below this line. The facts were worth
                keeping; the card was not. */}
            {blueprint && (
              <button
                type="button"
                onClick={() => setDetailTab('planning')}
                className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-xs font-medium text-slate-600 transition-colors hover:border-violet-300 hover:bg-violet-50 hover:text-violet-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
                title="Open the Course Blueprint"
              >
                <BookOpenCheck className="h-3.5 w-3.5" />
                Blueprint v{blueprint.version} · {blueprint.weekly_plan.length} weeks
              </button>
            )}
          </div>
          <p className="text-sm text-slate-500 mt-1">
            {selectedBatch.course_name && (
              <span className="font-medium text-slate-700">{selectedBatch.course_name}</span>
            )}
            {selectedBatch.course_name && selectedBatch.academic_year && ' · '}
            {selectedBatch.academic_year}
            {selectedBatch.term && ` · ${selectedBatch.term}`}
            {selectedBatch.createdAt && <> · Created {formatDate(selectedBatch.createdAt)}</>}
          </p>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          <button type="button" onClick={() => setSelectedBatch(null)} className={BTN_SECONDARY}>
            <ArrowLeft className="w-4 h-4 mr-1" />
            Back
          </button>
          <button
            type="button"
            onClick={() => handleDeleteBatch(selectedBatch)}
            className="inline-flex items-center gap-1.5 min-h-[44px] px-3 py-2 text-sm font-medium rounded-md border border-red-200 text-red-700 bg-white hover:bg-red-50 transition-colors"
          >
            <Trash2 className="w-4 h-4" />
            Delete Batch
          </button>
        </div>
      </div>

      <BatchTabs
        tabs={[
          { id: 'planning', label: 'Planning', icon: BookOpenCheck },
          { id: 'students', label: 'Students', icon: Users },
          /* "Chats", not "Sessions". A session reads as a login session or a
             class meeting, neither of which this is — and the tab's own copy
             had already drifted to the honest word ("Show older chats"). Not
             "History" either: the tab is where a chat is *started*, so naming
             it for the past would describe half of it. The `materials` id is
             untouched — it is in the URL as `?tab=materials`. */
          { id: 'materials', label: 'Chats', icon: MessageCircle },
          {
            id: 'artifacts',
            label: 'Generated content',
            icon: Sparkles,
            badge: artifacts.length + games.length,
          },
        ]}
        active={detailTab}
        onChange={setDetailTab}
      />

      <div
        id={`batch-panel-${shownTab}`}
        role="tabpanel"
        aria-labelledby={`batch-tab-${shownTab}`}
        className={`mila-tabpanel ${shownTab === 'materials' ? 'flex min-h-0 flex-1 flex-col' : ''}`}
        data-leaving={tabLeaving ? 'true' : undefined}
      >
        {shownTab === 'students' && (
          <StudentsTab
            students={students}
            studentsLoading={studentsLoading}
            studentForm={studentForm}
            setStudentForm={setStudentForm}
            addingStudent={addingStudent}
            csvUploading={csvUploading}
            onAddStudent={handleAddStudent}
            onRemoveStudent={handleRemoveStudent}
            onCsvUpload={handleCsvUpload}
          />
        )}

        {shownTab === 'materials' && (
          <MaterialsTab
            batchId={selectedBatch.id}
            files={files}
            filesLoading={filesLoading}
            fileUploading={fileUploading}
            fileInputRef={fileInputRef}
            onFileUpload={handleFileUpload}
            onDeleteFile={handleDeleteFile}
            onRefreshFiles={handleRefreshFiles}
          />
        )}

        {shownTab === 'planning' && <PlanningTab batchId={selectedBatch.id} />}

        {shownTab === 'artifacts' && (
          <ArtifactsTab
            artifacts={artifacts}
            games={games}
            summary={artifactSummary}
            loading={artifactsLoading}
            onRefresh={refreshArtifacts}
            onDelete={handleDeleteArtifact}
            onDeleteGame={handleDeleteGame}
            batchId={selectedBatch.id}
            onGameUpdated={handleGameUpdated}
            onError={(message) => setToast({ type: 'error', message })}
          />
        )}
      </div>
    </div>
  )
}
