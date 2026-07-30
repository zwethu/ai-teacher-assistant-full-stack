import { CheckCircle2, XCircle } from 'lucide-react'
import type { IndexStatus } from '../../../entity/File'
import { Spinner } from '../../../design-system'

export function IndexStatusBadge({ status }: { status: IndexStatus }) {
  const map: Record<IndexStatus, { label: string; icon: React.ReactNode; cls: string }> = {
    uploading: {
      label: 'Uploading',
      icon: <Spinner size={12} />,
      cls: 'bg-sky-50 text-sky-700 border-sky-100',
    },
    pending: {
      label: 'Pending', icon: <Spinner size={12} />,
      cls: 'bg-sky-50 text-sky-700 border-sky-100',
    },
    indexing: {
      label: 'Indexing',
      icon: <Spinner size={12} />,
      cls: 'bg-amber-50 text-amber-700 border-amber-100',
    },
    indexed: {
      label: 'Indexed',
      icon: <CheckCircle2 className="w-3 h-3" />,
      cls: 'bg-violet-50 text-violet-700 border-violet-100',
    },
    failed: {
      label: 'Failed',
      icon: <XCircle className="w-3 h-3" />,
      cls: 'bg-red-50 text-red-700 border-red-100',
    },
    deleting: {
      label: 'Deleting',
      icon: <Spinner size={12} />,
      cls: 'bg-slate-50 text-slate-500 border-slate-200',
    },
  }
  const { label, icon, cls } = map[status] ?? map.failed
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${cls}`}
    >
      {icon}
      {label}
    </span>
  )
}
