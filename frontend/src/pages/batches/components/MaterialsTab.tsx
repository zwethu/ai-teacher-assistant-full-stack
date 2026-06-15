import type { ChangeEvent, RefObject } from 'react'
import type { BatchFile } from '../../../entity/File'
import { Clock, FileText, Loader2, Trash2, Upload } from 'lucide-react'
import { formatDate } from '../../../utils/formatDate'
import { BTN_PRIMARY } from '../constants'
import { IndexStatusBadge } from './IndexStatusBadge'

type Props = {
  files: BatchFile[]
  filesLoading: boolean
  fileUploading: boolean
  fileInputRef: RefObject<HTMLInputElement | null>
  onFileUpload: (e: ChangeEvent<HTMLInputElement>) => void
  onDeleteFile: (file: BatchFile) => void
}

export function MaterialsTab({
  files,
  filesLoading,
  fileUploading,
  fileInputRef,
  onFileUpload,
  onDeleteFile,
}: Props) {
  return (
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
            onChange={onFileUpload}
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
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Uploading…
              </>
            ) : (
              <>
                <Upload className="w-4 h-4" />
                Upload File
              </>
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
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    File
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    Uploaded
                  </th>
                  <th className="relative px-6 py-3">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {files.map((f) => (
                  <tr key={f.file_id} className="group hover:bg-slate-50/90 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <FileText className="w-4 h-4 text-slate-400 flex-shrink-0" />
                        <div className="min-w-0">
                          <div
                            className="text-sm font-medium text-slate-900 truncate max-w-[260px]"
                            title={f.file_name}
                          >
                            {f.file_title || f.file_name}
                          </div>
                          {f.file_title !== f.file_name && (
                            <div className="text-xs text-slate-400 truncate max-w-[260px]">
                              {f.file_name}
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="space-y-1">
                        <IndexStatusBadge status={f.index_status} />
                        {f.index_status === 'failed' && f.index_error && (
                          <p
                            className="text-xs text-red-500 max-w-[220px] truncate"
                            title={f.index_error}
                          >
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
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <button
                        type="button"
                        onClick={() => onDeleteFile(f)}
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
  )
}
