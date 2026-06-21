import { ChevronDown, ChevronRight, Wrench } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import type { NormalizedRunRow } from './normalizeRunRows'

type Props = {
  row: NormalizedRunRow
}

export function StepTimelineRow({ row }: Props) {
  const [open, setOpen] = useState(false)
  const link = artifactLink(row.detail)
  const hasDetails =
    Boolean(row.summary) ||
    Boolean(row.detail && Object.keys(row.detail).length > 0) ||
    Boolean(link)

  return (
    <CollapsibleRow
      open={open}
      onToggle={() => setOpen((value) => !value)}
      icon={row.kind === 'tool' ? <Wrench className="h-3.5 w-3.5 flex-shrink-0 text-slate-500" /> : <ChevronIcon open={open} />}
      title={row.title}
      status={row.status}
      failed={row.kind === 'error' || row.status === 'failed'}
      hasDetails={hasDetails}
      expanded={
        <>
          {row.summary && <div className="text-slate-600">{row.summary}</div>}
          {row.detail && Object.keys(row.detail).length > 0 && (
            <DetailBlock detail={row.detail} />
          )}
          {link && (
            <a
              href={link}
              target="_blank"
              rel="noreferrer"
              className="font-medium text-emerald-700 underline underline-offset-2"
            >
              Open artifact
            </a>
          )}
        </>
      }
    />
  )
}

function CollapsibleRow({
  open,
  onToggle,
  icon,
  title,
  status,
  failed,
  hasDetails,
  expanded,
}: {
  open: boolean
  onToggle: () => void
  icon: ReactNode
  title: string
  status: string
  failed?: boolean
  hasDetails: boolean
  expanded: ReactNode
}) {
  return (
    <div className="rounded-md border border-slate-200/80 bg-white/80">
      <button
        type="button"
        onClick={hasDetails ? onToggle : undefined}
        className="flex w-full items-center gap-2 px-2.5 py-2 text-left text-xs"
      >
        {icon}
        <span className="min-w-0 flex-1 truncate font-medium text-slate-700">{title}</span>
        <StatusBadge status={status} failed={failed} />
      </button>
      {open && hasDetails && (
        <div className="space-y-1.5 border-t border-slate-100 px-2.5 py-2 text-xs leading-5 text-slate-600">
          {expanded}
        </div>
      )}
    </div>
  )
}

function StatusBadge({ status, failed }: { status: string; failed?: boolean }) {
  if (failed || status === 'failed') {
    return <span className="rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-semibold text-red-700">Failed</span>
  }
  if (status === 'done' || status === 'success') {
    return <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">Done</span>
  }
  if (status === 'running' || status === 'started') {
    return <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700">Running</span>
  }
  return <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">{status}</span>
}

function ChevronIcon({ open }: { open: boolean }) {
  return open ? (
    <ChevronDown className="h-3.5 w-3.5 flex-shrink-0 text-slate-500" />
  ) : (
    <ChevronRight className="h-3.5 w-3.5 flex-shrink-0 text-slate-500" />
  )
}

function DetailBlock({ detail }: { detail: Record<string, unknown> }) {
  return (
    <pre className="max-h-40 overflow-auto rounded bg-slate-50 p-2 text-[11px] leading-4 text-slate-700">
      {JSON.stringify(detail, null, 2)}
    </pre>
  )
}

function artifactLink(detail?: Record<string, unknown>): string {
  if (!detail) return ''
  for (const key of ['doc_url', 'form_url', 'lecturer_doc_url', 'student_doc_url']) {
    const value = detail[key]
    if (typeof value === 'string' && value.startsWith('http')) return value
  }
  return ''
}
