import { X } from 'lucide-react'
import { Spinner } from '../../../design-system'
import { BTN_PRIMARY, BTN_SECONDARY, INPUT_CLASS } from '../constants'
import type { BatchesPageState } from '../hooks/useBatchesPage'

type Props = Pick<
  BatchesPageState,
  | 'isEditOpen'
  | 'editDetails'
  | 'setEditDetails'
  | 'isSavingEdit'
  | 'closeEditDialog'
  | 'handleSaveBatchDetails'
>

export function EditBatchDialog(props: Props) {
  const {
    isEditOpen,
    editDetails,
    setEditDetails,
    isSavingEdit,
    closeEditDialog,
    handleSaveBatchDetails,
  } = props

  if (!isEditOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
        onClick={closeEditDialog}
        aria-hidden="true"
      />
      <div className="relative w-full max-w-lg rounded-xl bg-white shadow-2xl border border-slate-200 overflow-hidden max-h-[90vh] flex flex-col">
        <div className="bg-slate-50 px-4 py-3 border-b border-slate-200 flex items-center justify-between flex-shrink-0">
          <h3 className="text-base font-semibold text-slate-800">Edit batch details</h3>
          <button
            type="button"
            onClick={closeEditDialog}
            disabled={isSavingEdit}
            className="text-slate-400 hover:text-slate-600 p-1 rounded-md hover:bg-slate-200 disabled:opacity-60"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form
          className="p-6 overflow-y-auto flex-1 space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            void handleSaveBatchDetails()
          }}
        >
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Batch Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              required
              value={editDetails.batch_name}
              onChange={(e) => setEditDetails((d) => ({ ...d, batch_name: e.target.value }))}
              placeholder="e.g., CS101 Group A"
              className={INPUT_CLASS}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Course Name</label>
            <input
              type="text"
              value={editDetails.course_name}
              onChange={(e) => setEditDetails((d) => ({ ...d, course_name: e.target.value }))}
              placeholder="e.g., Introduction to Computer Science"
              className={INPUT_CLASS}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Academic Year</label>
              <input
                type="text"
                value={editDetails.academic_year}
                onChange={(e) => setEditDetails((d) => ({ ...d, academic_year: e.target.value }))}
                placeholder="e.g., 2025–2026"
                className={INPUT_CLASS}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Term</label>
              <input
                type="text"
                value={editDetails.term}
                onChange={(e) => setEditDetails((d) => ({ ...d, term: e.target.value }))}
                placeholder="e.g., Semester 1"
                className={INPUT_CLASS}
              />
            </div>
          </div>

          <p className="text-xs text-slate-500">
            Renaming also updates the batch&apos;s Google Drive folder when Google Workspace is
            connected. Existing chats and generated content stay linked either way.
          </p>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={closeEditDialog}
              disabled={isSavingEdit}
              className={BTN_SECONDARY}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSavingEdit || !editDetails.batch_name.trim()}
              className={BTN_PRIMARY}
            >
              {isSavingEdit && <Spinner size={16} />}
              {isSavingEdit ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
