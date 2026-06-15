import type { ChangeEvent, FormEvent } from 'react'
import type { BatchStudent } from '../../../entity/Batch'
import { Loader2, Plus, Trash2, Upload, UserPlus, Users } from 'lucide-react'

type Props = {
  students: BatchStudent[]
  studentsLoading: boolean
  studentForm: { name: string; email: string }
  setStudentForm: React.Dispatch<React.SetStateAction<{ name: string; email: string }>>
  addingStudent: boolean
  csvUploading: boolean
  onAddStudent: (e: FormEvent) => void
  onRemoveStudent: (student: BatchStudent) => void
  onCsvUpload: (e: ChangeEvent<HTMLInputElement>) => void
}

export function StudentsTab({
  students,
  studentsLoading,
  studentForm,
  setStudentForm,
  addingStudent,
  csvUploading,
  onAddStudent,
  onRemoveStudent,
  onCsvUpload,
}: Props) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-1 space-y-5">
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5">
          <h2 className="text-sm font-semibold text-slate-800 mb-4 flex items-center gap-2">
            <UserPlus className="w-4 h-4 text-emerald-600" />
            Add student
          </h2>
          <form onSubmit={onAddStudent} className="space-y-3">
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
            <input
              type="file"
              accept=".csv"
              onChange={onCsvUpload}
              disabled={csvUploading}
              className="sr-only"
            />
            <span className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium rounded-md border border-slate-300 text-slate-700 bg-white hover:bg-slate-50 transition-colors disabled:opacity-70">
              {csvUploading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Importing…
                </>
              ) : (
                <>
                  <Upload className="w-4 h-4" />
                  Choose CSV file
                </>
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
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    Name
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    Email
                  </th>
                  <th className="relative px-6 py-3">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {students.map((student) => (
                  <tr key={student.id} className="group hover:bg-slate-50/90 transition-colors">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-medium text-slate-900 group-hover:text-emerald-600 transition-colors">
                        {student.name}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-500">{student.email}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <button
                        type="button"
                        onClick={() => onRemoveStudent(student)}
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
  )
}
