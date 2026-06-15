import type { Batch } from '../../../entity/Batch'
import type { BatchStudent } from '../../../entity/Batch'
import type { BatchFile } from '../../../entity/File'
import Toast from '../../../components/ui/Toast'
import type { ToastMessage } from '../../../types'
import { formatDate } from '../../../utils/formatDate'
import { ArrowLeft, BookOpen, Trash2, Users } from 'lucide-react'
import { BTN_SECONDARY } from '../constants'
import type { DetailTab } from '../types'
import { MaterialsTab } from './MaterialsTab'
import { StudentsTab } from './StudentsTab'

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
}: Props) {
  return (
    <div>
      <Toast toast={toast} onDismiss={() => setToast(null)} />

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
            {selectedBatch.createdAt && <> · Created {formatDate(selectedBatch.createdAt)}</>}
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

      {detailTab === 'students' && (
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

      {detailTab === 'materials' && (
        <MaterialsTab
          files={files}
          filesLoading={filesLoading}
          fileUploading={fileUploading}
          fileInputRef={fileInputRef}
          onFileUpload={handleFileUpload}
          onDeleteFile={handleDeleteFile}
        />
      )}
    </div>
  )
}
