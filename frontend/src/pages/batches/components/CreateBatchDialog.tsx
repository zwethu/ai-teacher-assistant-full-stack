import { ArrowLeft, Loader2, Plus, Upload, UserPlus, X } from 'lucide-react'
import { BTN_BACK, BTN_PRIMARY, INPUT_CLASS } from '../constants'
import type { BatchesPageState } from '../hooks/useBatchesPage'
import { modalTitle } from '../utils/modalTitle'

type Props = Pick<
  BatchesPageState,
  | 'isCreateOpen'
  | 'createStep'
  | 'setCreateStep'
  | 'batchDetails'
  | 'setBatchDetails'
  | 'manualStudents'
  | 'setManualStudents'
  | 'csvStudents'
  | 'csvFileName'
  | 'tempName'
  | 'setTempName'
  | 'tempEmail'
  | 'setTempEmail'
  | 'isSubmitting'
  | 'csvError'
  | 'createStatus'
  | 'closeCreateDialog'
  | 'isDetailsComplete'
  | 'handleCreateWithStudents'
  | 'handleAddManualStudent'
  | 'handleCsvFileSelect'
>

export function CreateBatchDialog(props: Props) {
  const {
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
    closeCreateDialog,
    isDetailsComplete,
    handleCreateWithStudents,
    handleAddManualStudent,
    handleCsvFileSelect,
  } = props

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
          <h3 className="text-base font-semibold text-slate-800">{modalTitle(createStep)}</h3>
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
                  <div className="font-semibold text-slate-900 text-sm mt-3 mb-1">Upload CSV File</div>
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
                  <div className="font-semibold text-slate-900 text-sm mt-3 mb-1">Add Manually</div>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    Enter each student&apos;s name and email one by one.
                  </p>
                </button>
              </div>

              <div className="flex items-center justify-between pt-2">
                <button type="button" className={BTN_BACK} onClick={() => setCreateStep('details')}>
                  <ArrowLeft className="w-4 h-4 mr-1" />
                  Back
                </button>
              </div>
            </div>
          )}

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
                  <span className="font-mono bg-slate-100 px-1 rounded text-slate-600">name</span> and{' '}
                  <span className="font-mono bg-slate-100 px-1 rounded text-slate-600">email</span>.
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
                        <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600">Name</th>
                        <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600">Email</th>
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
          )}

          {createStep === 'manual' && (
            <div className="space-y-4">
              <div className="border-t border-slate-100 pt-2">
                <label className="block text-sm font-medium text-slate-700 mb-3">Add Students</label>
                <div className="grid grid-cols-[1fr_1fr_auto] gap-2 mb-2 items-center">
                  <input
                    type="text"
                    placeholder="Student name"
                    value={tempName}
                    onChange={(e) => setTempName(e.target.value)}
                    onKeyDown={(e) =>
                      e.key === 'Enter' && (e.preventDefault(), handleAddManualStudent())
                    }
                    className="block w-full rounded-md border border-emerald-200 bg-slate-50 focus:bg-white focus:border-emerald-500 py-2.5 px-2 text-sm"
                  />
                  <input
                    type="email"
                    placeholder="Student email"
                    value={tempEmail}
                    onChange={(e) => setTempEmail(e.target.value)}
                    onKeyDown={(e) =>
                      e.key === 'Enter' && (e.preventDefault(), handleAddManualStudent())
                    }
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
          )}
        </div>
      </div>
    </div>
  )
}
