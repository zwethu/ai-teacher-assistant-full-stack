import { useEffect, useState } from 'react'
import {
  BookOpen,
  Bot,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FileText,
  FileQuestion,
  FlaskConical,
  Loader2,
  User,
} from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import rehypeSanitize from 'rehype-sanitize'
import remarkGfm from 'remark-gfm'
import type { ChatMessage } from '../../../entity/Chat'
import { startGoogleOAuth } from '../../../services/authService'
import { exportPendingQuizToGoogleForms, generateDocsFromPendingArtifact } from '../../../services/chatService'
import {
  exportArtifactDraftToGoogleDocs,
  exportQuizDraftToGoogleForms,
  getArtifact,
  type Artifact,
  type LessonPlanExportResult,
} from '../../../services/artifactService'
import type { RunUiState } from '../runTypes'
import { splitSourcesSection } from '../utils/splitSourcesSection'
import { RunDetails } from './run/RunDetails'
import { ThinkingPanel } from './run/ThinkingPanel'

export function MessageRow({
  msg,
  run,
  batchId,
  onApproveOutline,
  approvalDisabled = false,
}: {
  msg?: ChatMessage | null
  run?: RunUiState
  batchId?: string
  onApproveOutline?: (message: ChatMessage) => void
  approvalDisabled?: boolean
}) {
  if (!msg) return null

  const isUser = msg.role === 'user'
  const isFinal = !msg.pending && msg.status !== 'pending'
  const isPending = Boolean(msg.pending || msg.status === 'pending')
  const isFailed = msg.status === 'failed' || run?.status === 'failed'
  const shouldUseArtifactCard = isGeneratedArtifactPreviewMessage(msg, isPending)
  const shouldUseOutlineCard = isOutlineApprovalMessage(msg, isPending)

  return (
    <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : ''}`}>
      <div
        className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
          isUser
            ? 'bg-emerald-500/90 text-white shadow-md shadow-emerald-500/20'
            : 'bg-white/70 border border-white/60 text-slate-600 shadow-sm'
        }`}
      >
        {isUser ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
      </div>
      <div className={`flex-1 min-w-0 pt-1 ${isUser ? 'flex justify-end' : ''}`}>
        {isUser ? (
          <div className="inline-block max-w-full text-[15px] leading-7 whitespace-pre-wrap px-4 py-2.5 rounded-3xl rounded-br-md bg-emerald-500/15 border border-emerald-300/30 text-slate-800">
            {msg.content}
          </div>
        ) : (
          <div className="max-w-full text-[15px] leading-7 text-slate-700">
            <RunDetails run={run} isFinal={isFinal} />
            {run && (
              <div className="mt-2">
                <ThinkingPanel
                  events={run.events}
                  runStatus={run.status}
                  responseStarted={run.responseStarted}
                />
              </div>
            )}
            <div className={run ? 'mt-3' : ''}>
              {isFailed && !msg.content ? (
                <p className="text-sm text-slate-600">
                  The agent run failed before producing a final response.
                </p>
              ) : isPending && !msg.content ? (
                <ThinkingIndicator />
              ) : msg.content ? (
                shouldUseOutlineCard ? (
                  <OutlineApprovalCard
                    msg={msg}
                    disabled={approvalDisabled}
                    onApprove={() => onApproveOutline?.(msg)}
                  />
                ) : shouldUseArtifactCard ? (
                  <ArtifactPreviewCard content={msg.content} metadata={msg.metadata || {}} />
                ) : (
                  <ResponseMarkdown content={msg.content} streaming={isPending} />
                )
              ) : null}
            </div>
            {!isUser && batchId && <ArtifactExportButton batchId={batchId} msg={msg} />}
          </div>
        )}
      </div>
    </div>
  )
}

function isOutlineApprovalMessage(msg: ChatMessage, isPending: boolean) {
  const metadata = msg.metadata || {}
  return msg.role === 'assistant' && !isPending && msg.status !== 'failed' &&
    metadata.workflow_stage === 'outline' && metadata.outline_approvable === true &&
    ['lesson_plan', 'lab', 'quiz'].includes(String(metadata.outline_artifact_type || metadata.artifact_type || ''))
}

function OutlineApprovalCard({
  msg, disabled, onApprove,
}: {
  msg: ChatMessage
  disabled: boolean
  onApprove: () => void
}) {
  const metadata = msg.metadata || {}
  const type = String(metadata.outline_artifact_type || metadata.artifact_type || '')
  const label = type === 'lab' ? 'Lab Outline' : type === 'quiz' ? 'Assessment Configuration' : 'Lesson Plan Outline'
  const Icon = type === 'lab' ? FlaskConical : type === 'quiz' ? FileQuestion : BookOpen
  return (
    <div className="rounded-xl border border-sky-200 bg-white/80 shadow-sm">
      <div className="flex items-center gap-3 border-b border-sky-100 px-4 py-3">
        <Icon className="h-5 w-5 text-sky-700" />
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-sky-700">{label}</div>
          <div className="font-semibold text-slate-900">{String(metadata.outline_title || metadata.artifact_title || '')}</div>
        </div>
      </div>
      <div className="px-4 py-3"><ResponseMarkdown content={msg.content} streaming={false} /></div>
      <div className="border-t border-sky-100 px-4 py-3">
        <button
          type="button"
          disabled={disabled}
          onClick={onApprove}
          className="rounded-md bg-sky-700 px-3 py-2 text-sm font-medium text-white hover:bg-sky-800 disabled:opacity-50"
        >
          Approve and generate full preview
        </button>
        <p className="mt-2 text-xs text-slate-500">Reply with changes if you want me to revise the outline before full generation.</p>
      </div>
    </div>
  )
}

function isGeneratedArtifactPreviewMessage(msg: ChatMessage, isPending: boolean) {
  if (msg.role !== 'assistant' || isPending || msg.status === 'failed') return false

  const content = msg.content?.trim()
  if (!content) return false

  const metadata = msg.metadata || {}
  const artifactType = String(metadata.artifact_type || metadata.pending_artifact_type || '')
  const isArtifactType = artifactType === 'lesson_plan' || artifactType === 'lab' || artifactType === 'quiz'
  const explicitCard = metadata.artifact_preview_card === true
  const isExportablePreview =
    metadata.pending_exportable === true ||
    metadata.exportable === true ||
    Boolean(metadata.pending_artifact_id) ||
    Boolean(metadata.draft_artifact_id)

  return isArtifactType && (explicitCard || isExportablePreview)
}

function ArtifactPreviewCard({
  content,
  metadata,
}: {
  content: string
  metadata: Record<string, unknown>
}) {
  const [expanded, setExpanded] = useState(false)
  const artifactType = String(metadata.artifact_type || metadata.pending_artifact_type || '')
  const isLab = artifactType === 'lab'
  const isQuiz = artifactType === 'quiz'
  const label = isLab ? 'Lab Preview' : isQuiz ? 'Assessment Preview' : 'Lesson Plan Preview'
  const fallbackTitle = isLab
    ? 'Generated lab preview'
    : isQuiz
      ? 'Generated assessment preview'
      : 'Generated lesson plan preview'
  const title =
    metadataText(metadata.artifact_title) || extractFirstMarkdownHeading(content) || fallbackTitle
  const week = metadata.week || metadata.pending_artifact_week
  const weekLabel = week !== undefined && week !== null && String(week).trim()
    ? `Week ${String(week)}`
    : ''
  const summary = extractPreviewSummary(content)
  const Icon = isLab ? FlaskConical : isQuiz ? FileQuestion : BookOpen

  return (
    <div className="overflow-hidden rounded-xl border border-emerald-200 bg-white/70 shadow-sm transition-colors hover:bg-white/80">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        className="w-full px-4 py-4 text-left"
      >
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700">
            <Icon className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
                {label}
              </span>
              {weekLabel && <span className="text-xs text-slate-500">{weekLabel}</span>}
            </div>
            <h3 className="mt-1 text-base font-semibold leading-6 text-slate-900">{title}</h3>
            {summary && <p className="mt-1.5 line-clamp-3 text-sm leading-5 text-slate-600">{summary}</p>}
            <div className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-emerald-700">
              <ChevronRight
                className={`h-4 w-4 transition-transform ${expanded ? 'rotate-90' : ''}`}
              />
              {expanded ? 'Hide full preview' : 'View full preview'}
            </div>
          </div>
        </div>
      </button>
      {expanded && (
        <div className="max-h-[70vh] overflow-y-auto border-t border-emerald-100 bg-white/80 px-4 py-3">
          <ResponseMarkdown content={content} streaming={false} />
        </div>
      )}
    </div>
  )
}

function metadataText(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function extractFirstMarkdownHeading(content: string) {
  const match = content.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/m)
  return match ? stripInlineMarkdown(match[1]) : ''
}

function extractPreviewSummary(content: string) {
  const paragraphs = content
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter((block) => block && !/^\s{0,3}#{1,6}\s/.test(block))
  const source = paragraphs[0] || content
  const plain = stripInlineMarkdown(source).replace(/\s+/g, ' ').trim()
  return plain.length > 220 ? `${plain.slice(0, 217).trimEnd()}…` : plain
}

function stripInlineMarkdown(value: string) {
  return value
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[`*_~>#|]/g, '')
    .replace(/^\s*[-+]\s+/gm, '')
    .trim()
}

function ResponseMarkdown({ content, streaming }: { content: string; streaming: boolean }) {
  const [sourcesOpen, setSourcesOpen] = useState(false)
  const { body, sources } = splitSourcesSection(content)

  return (
    <div className="animate-in fade-in duration-300">
      {streaming && (
        <div className="mb-1 inline-flex items-center gap-2 text-xs font-medium text-slate-500">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
          Generating...
        </div>
      )}
      <MarkdownBlock content={body || content} />
      {sources && (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setSourcesOpen((value) => !value)}
            className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white/70 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-white hover:text-slate-900"
          >
            <FileText className="h-3.5 w-3.5" />
            Sources
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${sourcesOpen ? 'rotate-180' : ''}`} />
          </button>
          {sourcesOpen && (
            <div className="mt-2 rounded-lg border border-slate-200 bg-white/70 px-3 py-2 text-sm">
              <MarkdownBlock content={sources} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function MarkdownBlock({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeSanitize]}
      components={{
        h1: ({ ...props }) => <h1 className="mt-3 mb-2 text-xl font-semibold text-slate-900" {...props} />,
        h2: ({ ...props }) => <h2 className="mt-3 mb-2 text-lg font-semibold text-slate-900" {...props} />,
        h3: ({ ...props }) => <h3 className="mt-3 mb-2 text-base font-semibold text-slate-900" {...props} />,
        p: ({ ...props }) => <p className="my-2" {...props} />,
        ul: ({ ...props }) => <ul className="my-2 list-disc pl-5 space-y-1" {...props} />,
        ol: ({ ...props }) => <ol className="my-2 list-decimal pl-5 space-y-1" {...props} />,
        li: ({ ...props }) => <li className="pl-1" {...props} />,
        a: ({ ...props }) => (
          <a
            className="font-medium text-emerald-700 underline underline-offset-2 hover:text-emerald-800"
            target="_blank"
            rel="noreferrer"
            {...props}
          />
        ),
        table: ({ ...props }) => (
          <div className="my-3 max-w-full overflow-x-auto rounded-lg border border-slate-200">
            <table className="min-w-full divide-y divide-slate-200 text-sm" {...props} />
          </div>
        ),
        th: ({ ...props }) => <th className="bg-slate-50 px-3 py-2 text-left font-semibold text-slate-800" {...props} />,
        td: ({ ...props }) => <td className="border-t border-slate-100 px-3 py-2 align-top" {...props} />,
        code: ({ className, children, ...props }) => {
          const isBlock = /language-/.test(className || '')
          return isBlock ? (
            <code className={className} {...props}>
              {children}
            </code>
          ) : (
            <code className="rounded bg-slate-100 px-1.5 py-0.5 text-[0.92em] text-slate-800" {...props}>
              {children}
            </code>
          )
        },
        pre: ({ ...props }) => (
          <pre className="my-3 max-w-full overflow-x-auto rounded-lg bg-slate-950 px-4 py-3 text-sm leading-6 text-slate-100" {...props} />
        ),
        blockquote: ({ ...props }) => (
          <blockquote className="my-3 border-l-4 border-emerald-300 pl-4 text-slate-600" {...props} />
        ),
      }}
    >
      {content}
    </ReactMarkdown>
  )
}

function ArtifactExportButton({
  batchId,
  msg,
}: {
  batchId: string
  msg: ChatMessage
}) {
  const metadata = msg.metadata || {}
  const artifactId = String(metadata.draft_artifact_id || '')
  const pendingArtifactType = String(metadata.pending_artifact_type || '')
  const pendingExportable = metadata.pending_exportable === true
  const artifactType = String(metadata.artifact_type || pendingArtifactType || '')
  const exportable = metadata.exportable === true
  const runId = String(msg.run_id || '')
  const initialDocUrl = typeof metadata.doc_url === 'string' ? metadata.doc_url : ''
  const initialFormUrl = typeof metadata.form_url === 'string' ? metadata.form_url : ''
  const initialLecturerDocUrl =
    typeof metadata.lecturer_doc_url === 'string' ? metadata.lecturer_doc_url : ''
  const initialStudentDocUrl =
    typeof metadata.student_doc_url === 'string' ? metadata.student_doc_url : ''
  const [exporting, setExporting] = useState(false)
  const [result, setResult] = useState<LessonPlanExportResult | null>(
    initialDocUrl || initialFormUrl || initialLecturerDocUrl || initialStudentDocUrl
      ? {
          artifact_id: artifactId,
          status: 'confirmed',
          doc_url: initialDocUrl,
          form_url: initialFormUrl,
          lecturer_doc_url: initialLecturerDocUrl,
          student_doc_url: initialStudentDocUrl,
          version: typeof metadata.version === 'number' ? metadata.version : undefined,
          drive_file_name:
            typeof metadata.drive_file_name === 'string' ? metadata.drive_file_name : undefined,
          lecturer_drive_file_name:
            typeof metadata.lecturer_drive_file_name === 'string'
              ? metadata.lecturer_drive_file_name
              : undefined,
          student_drive_file_name:
            typeof metadata.student_drive_file_name === 'string'
              ? metadata.student_drive_file_name
              : undefined,
        }
      : null,
  )
  const [needsGoogle, setNeedsGoogle] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!artifactId || !isExportableArtifactType(artifactType)) return
    let cancelled = false
    getArtifact(batchId, artifactId)
      .then((artifact) => {
        if (cancelled) return
        if (artifact.status === 'confirmed') {
          setResult(artifactToExportResult(artifact))
          return
        }
        if (artifact.status === 'draft' || artifact.status === 'failed_export') {
          setResult(null)
        }
      })
      .catch(() => {
        // Keep metadata-driven fallback UI if artifact lookup is temporarily unavailable.
      })
    return () => {
      cancelled = true
    }
  }, [artifactId, artifactType, batchId])

  const hasConfirmedLink = Boolean(
    result?.doc_url || result?.form_url || result?.lecturer_doc_url || result?.student_doc_url,
  )
  const canExportPending = Boolean(
    pendingExportable &&
      runId &&
      msg.chat_id &&
      (pendingArtifactType === 'lesson_plan' || pendingArtifactType === 'lab' || pendingArtifactType === 'quiz'),
  )

  if (
    !isExportableArtifactType(artifactType) ||
    (!canExportPending && (!artifactId || (!exportable && !hasConfirmedLink)))
  ) {
    return null
  }

  async function handleExport() {
    setError('')
    setNeedsGoogle(false)
    setExporting(true)
    try {
      const exported = canExportPending
        ? pendingArtifactType === 'quiz'
          ? await exportPendingQuizToGoogleForms(batchId, msg.chat_id, runId)
          : await generateDocsFromPendingArtifact(batchId, msg.chat_id, runId)
        : artifactType === 'quiz'
          ? await exportQuizDraftToGoogleForms(batchId, artifactId)
          : await exportArtifactDraftToGoogleDocs(batchId, artifactId)
      if (artifactType === 'lab' && (!exported.lecturer_doc_url || !exported.student_doc_url)) {
        try {
          const artifact = await getArtifact(batchId, exported.artifact_id || artifactId)
          const refreshed = artifactToExportResult(artifact)
          setResult({
            ...exported,
            lecturer_doc_url: exported.lecturer_doc_url || refreshed.lecturer_doc_url,
            lecturer_doc_id: exported.lecturer_doc_id || refreshed.lecturer_doc_id,
            lecturer_drive_file_name:
              exported.lecturer_drive_file_name || refreshed.lecturer_drive_file_name,
            student_doc_url: exported.student_doc_url || refreshed.student_doc_url,
            student_doc_id: exported.student_doc_id || refreshed.student_doc_id,
            student_drive_file_name:
              exported.student_drive_file_name || refreshed.student_drive_file_name,
          })
          return
        } catch {
          // The export succeeded; keep the direct response if the follow-up read is unavailable.
        }
      }
      setResult(exported)
    } catch (err) {
      const maybe = err as { response?: { data?: { detail?: unknown } }; message?: string }
      const detail = maybe.response?.data?.detail
      if (typeof detail === 'string') {
        setError(detail)
        return
      }
      if (detail && typeof detail === 'object' && 'code' in detail) {
        const code = String((detail as { code?: unknown }).code || '')
        if (code === 'GOOGLE_OAUTH_REQUIRED') {
          setNeedsGoogle(true)
          return
        }
      }
      setError(maybe.message || 'Failed to export artifact.')
    } finally {
      setExporting(false)
    }
  }

  const exportLabel =
    canExportPending
      ? artifactType === 'quiz'
        ? 'Export to Google Forms'
        : artifactType === 'lab'
        ? 'Generate Lab Docs'
        : 'Generate Google Doc'
      : artifactType === 'lab'
        ? 'Export Lab Docs'
        : artifactType === 'quiz'
        ? 'Export to Google Forms'
        : 'Export to Google Docs'

  return (
    <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-200 pt-3">
      {hasConfirmedLink ? (
        <>
          {artifactType === 'lab' ? (
            <>
              <ExportLink href={result?.lecturer_doc_url || result?.doc_url} label="Open Lecturer Guide" />
              <ExportLink href={result?.student_doc_url} label="Open Student Instructions" />
            </>
          ) : artifactType === 'quiz' ? (
            <ExportLink href={result?.form_url || result?.doc_url} label="Open Google Form" />
          ) : (
            <ExportLink href={result?.doc_url} label="Open Google Doc" />
          )}
          <span className="text-xs text-slate-500">
            {exportedFileLabel(artifactType, result)}
            {result?.version ? ` · v${String(result.version).padStart(2, '0')}` : ''}
          </span>
        </>
      ) : (
        <button
          type="button"
          onClick={() => void handleExport()}
          disabled={exporting}
          className="inline-flex items-center gap-2 rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {exporting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <FileText className="h-4 w-4" />
          )}
          {exporting ? 'Exporting...' : exportLabel}
        </button>
      )}
      {needsGoogle && (
        <button
          type="button"
          onClick={startGoogleOAuth}
          className="inline-flex items-center rounded-md border border-emerald-200 bg-white px-3 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-50"
        >
          Connect Google
        </button>
      )}
      {error && <span className="text-sm text-red-600">{error}</span>}
    </div>
  )
}

function isExportableArtifactType(artifactType: string) {
  return artifactType === 'lesson_plan' || artifactType === 'lab' || artifactType === 'quiz'
}

function metadataString(artifact: Artifact, key: string) {
  const value = artifact.metadata?.[key]
  return typeof value === 'string' ? value : ''
}

function artifactToExportResult(artifact: Artifact): LessonPlanExportResult {
  return {
    artifact_id: artifact.id,
    status: artifact.status || 'confirmed',
    doc_url: artifact.doc_url,
    doc_id: artifact.doc_id,
    form_url: artifact.form_url || metadataString(artifact, 'form_url'),
    form_id: artifact.form_id || metadataString(artifact, 'form_id'),
    version: artifact.version,
    drive_file_name: artifact.drive_file_name,
    lecturer_doc_url: metadataString(artifact, 'lecturer_doc_url') || artifact.doc_url,
    lecturer_doc_id: metadataString(artifact, 'lecturer_doc_id') || artifact.doc_id,
    lecturer_drive_file_name: metadataString(artifact, 'lecturer_drive_file_name') || artifact.drive_file_name,
    student_doc_url: metadataString(artifact, 'student_doc_url'),
    student_doc_id: metadataString(artifact, 'student_doc_id'),
    student_drive_file_name: metadataString(artifact, 'student_drive_file_name'),
  }
}

function exportedFileLabel(artifactType: string, result: LessonPlanExportResult | null) {
  if (!result) return 'Exported'
  if (artifactType === 'lab') return result.drive_file_name || 'Lab docs exported'
  if (artifactType === 'quiz') return result.drive_file_name || 'Quiz exported'
  return result.drive_file_name || 'Lesson plan exported'
}

function ExportLink({ href, label }: { href?: string; label: string }) {
  if (!href) return null
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-2 rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700"
    >
      <ExternalLink className="h-4 w-4" />
      {label}
    </a>
  )
}

export function ThinkingIndicator() {
  return (
    <div className="flex gap-3">
      <div className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center bg-white/70 border border-white/60 text-slate-600 shadow-sm">
        <Bot className="w-4 h-4" />
      </div>
      <div className="pt-2">
        <div className="inline-flex items-center gap-1 px-4 py-3 rounded-2xl bg-white/50 border border-white/50">
          {[0, 150, 300].map((delay) => (
            <span
              key={delay}
              className="w-2 h-2 rounded-full bg-slate-400 animate-bounce"
              style={{ animationDelay: `${delay}ms` }}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
