import { ChevronDown, ChevronRight, ExternalLink, Search, Wrench } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import type { NormalizedRunRow } from './normalizeRunRows'

type Props = {
  row: NormalizedRunRow
}

export function StepTimelineRow({ row }: Props) {
  const [open, setOpen] = useState(false)
  const link = artifactLink(row.detail)
  const webSearchDetails = webSearchEventDetails(row)
  const hasDetails =
    Boolean(row.summary) ||
    Boolean(row.detail && Object.keys(row.detail).length > 0) ||
    Boolean(link)

  return (
    <CollapsibleRow
      open={open}
      onToggle={() => setOpen((value) => !value)}
      icon={webSearchDetails ? <Search className="h-3.5 w-3.5 flex-shrink-0 text-violet-600" /> : row.kind === 'tool' ? <Wrench className="h-3.5 w-3.5 flex-shrink-0 text-slate-500" /> : <ChevronIcon open={open} />}
      title={row.title}
      status={row.status}
      failed={row.kind === 'error' || row.status === 'failed'}
      hasDetails={hasDetails}
      expanded={
        <>
          {row.summary && <div className="text-slate-600">{row.summary}</div>}
          {webSearchDetails || (row.detail && Object.keys(row.detail).length > 0) ? (
            webSearchDetails ? <WebSearchDetail detail={row.detail || {}} /> : (
            <DetailBlock detail={row.detail || {}} />
            )
          ) : null}
          {link && (
            <a
              href={link}
              target="_blank"
              rel="noreferrer"
              className="font-medium text-violet-700 underline underline-offset-2"
            >
              Open artifact
            </a>
          )}
        </>
      }
    />
  )
}

function webSearchEventDetails(row: NormalizedRunRow): boolean {
  const source = row.source
  return Boolean(source && 'event_type' in source && String(source.event_type || '').startsWith('web_search.'))
}

export function WebSearchDetail({ detail }: { detail: Record<string, unknown> }) {
  const request = typeof detail.research_request === 'string' ? detail.research_request : ''
  const queries = Array.isArray(detail.queries) ? detail.queries.filter((value): value is string => typeof value === 'string').slice(0, 8) : []
  const sources = Array.isArray(detail.sources) ? detail.sources.filter((value): value is Record<string, unknown> => Boolean(value && typeof value === 'object')).slice(0, 10) : []
  const sourceCount = Number(detail.source_count)
  const citationCount = Number(detail.citation_count)
  const mode = typeof detail.extraction_mode === 'string' ? detail.extraction_mode : ''
  return (
    <div className="space-y-2">
      {request && <div><div className="font-semibold text-slate-700">Research request</div><div>{request}</div></div>}
      {queries.length > 0 && <div><div className="mb-1 font-semibold text-slate-700">Queries</div><div className="flex flex-wrap gap-1">{queries.map((query) => <span key={query} className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5">{query}</span>)}</div></div>}
      {sources.length > 0 && <div><div className="mb-1 font-semibold text-slate-700">Sources checked</div><div className="space-y-1">{sources.map((source, index) => {
        const url = typeof source.url === 'string' && /^https?:\/\//.test(source.url) ? source.url : ''
        const title = String(source.title || source.domain || `Source ${index + 1}`)
        return url ? <a key={url} href={url} target="_blank" rel="noreferrer" className="flex items-center gap-1 font-medium text-violet-700 underline underline-offset-2"><ExternalLink className="h-3 w-3" />{title}</a> : <div key={`${title}-${index}`}>{title}</div>
      })}</div></div>}
      {(Number.isFinite(sourceCount) || Number.isFinite(citationCount) || mode) && <div className="text-slate-500">{Number.isFinite(sourceCount) ? `${sourceCount} sources` : ''}{Number.isFinite(sourceCount) && Number.isFinite(citationCount) ? ' · ' : ''}{Number.isFinite(citationCount) ? `${citationCount} citations` : ''}{mode ? ` · ${mode.replaceAll('_', ' ')}` : ''}</div>}
    </div>
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
      {/* `data-step-head` is the handle `.mila-lane__in/__out` sweep by — its
          three children, in this order, are what move one after another when a
          lane changes hands. Declared here rather than left as a bare
          descendant selector in the stylesheet, so the coupling is visible
          from both ends and a reshuffle of this row cannot break the motion
          silently. */}
      <button
        type="button"
        data-step-head
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

/**
 * Keyed on the status it renders, so React remounts it when a step settles and
 * `.mila-badge-swap` replays. Running → Done changes the word and the colour at
 * once, and swapping that with no transition reads as two badges rather than
 * one badge changing state — the blur in that animation is what bridges them.
 */
function StatusBadge({ status, failed }: { status: string; failed?: boolean }) {
  const badge = 'mila-badge-swap rounded-full px-2 py-0.5 text-[10px] font-semibold'

  if (failed || status === 'failed') {
    return <span key="failed" className={`${badge} bg-red-50 text-red-700`}>Failed</span>
  }
  if (status === 'done' || status === 'success') {
    return <span key="done" className={`${badge} bg-emerald-50 text-emerald-700`}>Done</span>
  }
  if (status === 'running' || status === 'started') {
    return <span key="running" className={`${badge} bg-violet-50 text-violet-700`}>Running</span>
  }
  return <span key={status} className={`${badge} bg-slate-100 text-slate-600`}>{status}</span>
}

function ChevronIcon({ open }: { open: boolean }) {
  return open ? (
    <ChevronDown className="h-3.5 w-3.5 flex-shrink-0 text-slate-500" />
  ) : (
    <ChevronRight className="h-3.5 w-3.5 flex-shrink-0 text-slate-500" />
  )
}

export function DetailBlock({ detail }: { detail: Record<string, unknown> }) {
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
