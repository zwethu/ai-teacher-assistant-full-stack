import type { ToastMessage } from '../../../types'
import type { Batch } from '../../../entity/Batch'
import Toast from '../../../components/ui/Toast'
import { Eye, Loader2, Plus, Search, Trash2, Users, X } from 'lucide-react'
import { BTN_PRIMARY } from '../constants'
import type { BatchWithCount } from '../types'

type Props = {
  toast: ToastMessage | null
  setToast: (toast: ToastMessage | null) => void
  searchQuery: string
  setSearchQuery: (q: string) => void
  filteredBatches: BatchWithCount[]
  batches: BatchWithCount[]
  listLoading: boolean
  listError: string | null
  openCreateDialog: () => void
  setSelectedBatch: (batch: Batch) => void
  handleDeleteBatch: (batch: Batch) => void
}

export function BatchListView({
  toast,
  setToast,
  searchQuery,
  setSearchQuery,
  filteredBatches,
  batches,
  listLoading,
  listError,
  openCreateDialog,
  setSelectedBatch,
  handleDeleteBatch,
}: Props) {
  return (
    <div>
      <Toast toast={toast} onDismiss={() => setToast(null)} />

      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800 tracking-tight">Batches</h1>
        <p className="text-sm text-slate-500 mt-1">Manage your student groups and course rosters.</p>
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
            <p className="mt-1 text-sm text-slate-500 mb-6">Get started by creating a new batch.</p>
            <button type="button" onClick={openCreateDialog} className={`${BTN_PRIMARY} px-6 py-3 min-h-[48px]`}>
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
                              {batch.academic_year}
                              {batch.term ? ` · ${batch.term}` : ''}
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
