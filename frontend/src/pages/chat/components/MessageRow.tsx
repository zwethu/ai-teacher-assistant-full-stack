import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  BookOpen,
  CalendarClock,
  Check,
  CircleSlash,
  Copy,
  Download,
  ExternalLink,
  FileQuestion,
  FileText,
  FlaskConical,
  Gamepad2,
  Mail,
  Map as MapIcon,
  Maximize2,
  Pencil,
  RefreshCw,
  Save,
  Send,
  X,
} from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import rehypeKatex from 'rehype-katex'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import 'katex/dist/katex.min.css'
import { ThinkingRow, Spinner, Button } from '../../../design-system'
import type { ChatAttachmentSnapshot, ChatMessage } from '../../../entity/Chat'
import { startGoogleOAuth } from '../../../services/authService'
import {
  exportPendingQuizToGoogleForms,
  generateDocsFromPendingArtifact,
  schedulePendingEmail,
  sendPendingEmail,
  updatePendingEmail,
} from '../../../services/chatService'
import {
  exportArtifactDraftToGoogleDocs,
  exportQuizDraftToGoogleForms,
  getArtifact,
  type Artifact,
  type LessonPlanExportResult,
} from '../../../services/artifactService'
import type { RunUiState } from '../runTypes'
import { splitSourcesSection } from '../utils/splitSourcesSection'
import { SourceFavicon } from './SourceFavicon'
import {
  citationRemarkPlugin,
  normalizeWebCitations,
  normalizeWebQueries,
  normalizeWebSources,
  type WebSourceMetadata,
} from '../utils/webCitations'
import { RunDetails } from './run/RunDetails'
import { ThinkingPanel } from './run/ThinkingPanel'
import { createGameFromRun } from '../../../services/gameService'
import { saveBlueprintFromRun } from '../../../services/courseBlueprintService'
import { EXPORT_FORMAT_LABELS, exportMessage, type ChatExportFormat } from '../../../services/chatService'
import { AttachmentThumbnail, AttachmentViewer } from './AttachmentPreview'
import { EXPORT_FORMATS, EXPORT_FORMAT_ICONS } from './exportFormatIcons'

// Referenced prior attachments are conveyed to the agent as an id mention appended to the
// message (the backend rejects re-sending an already-sent attachment via attachment_ids).
// Strip those lines from the displayed bubble and render them as chips instead — matching
// how they appear in the composer — so the user never sees the raw "Attachment ID:" text.
const REFERENCED_ATTACHMENT_RE = /^Please use the earlier attachment (.+)\. Attachment ID: (\S+)$/

export function parseUserMessageContent(content: string): {
  body: string
  references: { title: string; id: string }[]
} {
  const references: { title: string; id: string }[] = []
  const bodyLines: string[] = []
  for (const line of content.split('\n')) {
    const match = line.match(REFERENCED_ATTACHMENT_RE)
    if (match) references.push({ title: match[1], id: match[2] })
    else bodyLines.push(line)
  }
  return { body: bodyLines.join('\n').trim(), references }
}

export function MessageRow({
  msg,
  run,
  batchId,
  onApproveOutline,
  approvalDisabled = false,
  approvalCompleted = false,
  approvalSuperseded = false,
  onRetry,
  retrying = false,
}: {
  msg?: ChatMessage | null
  run?: RunUiState
  batchId?: string
  /** Discard this response and re-run the request that produced it. */
  onRetry?: (message: ChatMessage) => void
  retrying?: boolean
  onApproveOutline?: (message: ChatMessage) => void
  approvalDisabled?: boolean
  approvalCompleted?: boolean
  approvalSuperseded?: boolean
}) {
  if (!msg) return null

  const isUser = msg.role === 'user'
  const isFinal = !msg.pending && msg.status !== 'pending'
  const isPending = Boolean(msg.pending || msg.status === 'pending')
  const isFailed = msg.status === 'failed' || run?.status === 'failed'
  // The lecturer pressed Stop. Whatever streamed first is discarded server-side,
  // so this replaces the body rather than annotating it.
  const isCancelled = run?.status === 'cancelled'
  // Run created but held until its attachments finish processing.
  const isAwaitingAttachments = run?.status === 'awaiting_attachments'
  const shouldUseArtifactCard = isGeneratedArtifactPreviewMessage(msg, isPending)
  const shouldUseOutlineCard = isOutlineApprovalMessage(msg, isPending)
  const assistantIntro = typeof msg.metadata?.assistant_intro === 'string'
    ? msg.metadata.assistant_intro.trim()
    : ''
  return (
    <div className="flex">
      <div className={`flex-1 min-w-0 pt-1 ${isUser ? 'flex justify-end' : ''}`}>
        {isUser ? (() => {
          const { body, references } = parseUserMessageContent(msg.content)
          return (
          <div className="max-w-full">
            {body && (
              <div className="inline-block max-w-full text-[15px] leading-7 whitespace-pre-wrap px-4 py-2.5 rounded-3xl rounded-br-md bg-violet-500/15 border border-violet-300/30 text-slate-800">
                {body}
              </div>
            )}
            {references.length > 0 && (
              <div className="mt-1 flex flex-wrap justify-end gap-2">
                {references.map((ref) => (
                  <div key={ref.id} className="flex items-center gap-2 rounded-xl border border-violet-200 bg-violet-50/80 px-2.5 py-1.5 shadow-sm">
                    <FileText className="h-4 w-4 flex-shrink-0 text-violet-600" />
                    <span className="max-w-[220px] truncate text-xs font-medium text-slate-700">{ref.title}</span>
                  </div>
                ))}
              </div>
            )}
            {batchId && msg.attachments && msg.attachments.length > 0 && (
              <MessageAttachments batchId={batchId} chatId={msg.chat_id} attachments={msg.attachments} />
            )}
          </div>
          )
        })() : (
          <div className="max-w-full text-[15px] leading-7 text-slate-700">
            {!isAwaitingAttachments && <RunDetails run={run} isFinal={isFinal} />}
            {run && !isAwaitingAttachments && (
              <div className="mt-2">
                <ThinkingPanel
                  events={run.events}
                  runStatus={run.status}
                />
              </div>
            )}
            <div className={run ? 'mt-3' : ''}>
              {isCancelled ? (
                <div className="flex items-start gap-2 text-sm text-slate-600">
                  <CircleSlash className="mt-0.5 h-4 w-4 flex-shrink-0 text-slate-400" />
                  <span>
                    You stopped this request.
                    {msg.content ? ' Everything generated before that was discarded.' : ''}
                  </span>
                </div>
              ) : isFailed && !msg.content ? (
                <p className="text-sm text-slate-600">
                  The agent run failed before producing a final response.
                </p>
              ) : isAwaitingAttachments && !msg.content ? (
                <p className="flex items-center gap-2 text-[15px] text-slate-600">
                  <Spinner size={16} className="flex-shrink-0" />
                  Processing your file(s)…
                </p>
              ) : isPending && !msg.content && !run ? (
                /* Only when there is no run yet — once a run exists the
                   ThinkingPanel above already shows the garland, and rendering
                   both put two identical marks on screen. */
                <ThinkingIndicator />
              ) : msg.content ? (
                shouldUseOutlineCard ? (
                  <>
                    <AssistantIntro content={assistantIntro} metadata={msg.metadata} />
                    <OutlineApprovalCard
                      msg={msg}
                      disabled={approvalDisabled}
                      completed={approvalCompleted}
                      superseded={approvalSuperseded}
                      onApprove={() => onApproveOutline?.(msg)}
                    />
                  </>
                ) : shouldUseArtifactCard ? (
                  <>
                    <AssistantIntro content={assistantIntro} metadata={msg.metadata} />
                    <ArtifactPreviewCard content={msg.content} metadata={msg.metadata || {}} />
                  </>
                ) : (
                  <ResponseMarkdown
                    content={msg.content}
                    streaming={isPending}
                    metadata={msg.metadata}
                    batchId={batchId}
                    chatId={msg.chat_id}
                    messageId={msg.message_id}
                    onRetry={onRetry && msg.message_id ? () => onRetry(msg) : undefined}
                    retrying={retrying}
                  />
                )
              ) : null}
            </div>
            {!isUser && batchId && <ArtifactExportButton batchId={batchId} msg={msg} />}
            {!isUser && batchId && <BlueprintSaveButton batchId={batchId} msg={msg} />}
            {!isUser && batchId && <GameCreateButton batchId={batchId} msg={msg} />}
            {!isUser && batchId && <EmailActionButtons batchId={batchId} msg={msg} />}
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Attachments shown under a sent user message.
 *
 * Images show their thumbnail; everything else shows a format badge. The whole
 * chip opens the viewer, so there is no separate "view" action. Availability is
 * probed rather than read from the snapshot: the snapshot is frozen at send
 * time and keeps claiming a thumbnail long after the file has aged out.
 */
/**
 * Attachments under a sent user message — preview only.
 *
 * Deliberately no filename, size or actions: the thumbnail already says what
 * was sent, and the row sits under the message where every extra word competes
 * with the message itself. Tap opens the full viewer.
 */
function MessageAttachments({
  batchId, chatId, attachments,
}: {
  batchId: string
  chatId: string
  attachments: ChatAttachmentSnapshot[]
}) {
  const [preview, setPreview] = useState<ChatAttachmentSnapshot | null>(null)

  return (
    <div className="mt-2 flex flex-wrap justify-end gap-2">
      {attachments.map((attachment) => (
        <button
          key={attachment.attachment_id}
          type="button"
          onClick={() => setPreview(attachment)}
          className="overflow-hidden rounded-xl border border-white/70 bg-white/70 shadow-sm transition-transform hover:scale-[1.03]"
          aria-label={`Preview ${attachment.file_name}`}
          title={attachment.file_name}
        >
          <AttachmentThumbnail
            batchId={batchId}
            chatId={chatId}
            attachment={attachment}
            className="h-20 w-20"
          />
        </button>
      ))}

      {preview && (
        <AttachmentViewer
          batchId={batchId}
          chatId={chatId}
          attachment={preview}
          onClose={() => setPreview(null)}
        />
      )}
    </div>
  )
}

function AssistantIntro({ content, metadata }: { content: string; metadata?: Record<string, unknown> }) {
  if (!content.trim()) return null
  return (
    <div className="mb-3">
      <ResponseMarkdown content={content} streaming={false} metadata={metadata} />
    </div>
  )
}

export function isOutlineApprovalMessage(msg: ChatMessage, isPending: boolean) {
  const metadata = msg.metadata || {}
  return msg.role === 'assistant' && !isPending && msg.status !== 'failed' &&
    metadata.workflow_stage === 'outline' && metadata.outline_approvable === true &&
    ['lesson_plan', 'lab', 'quiz', 'course_blueprint'].includes(String(metadata.outline_artifact_type || metadata.artifact_type || ''))
}

export function OutlineApprovalCard({
  msg, disabled, completed, superseded, onApprove,
}: {
  msg: ChatMessage
  disabled: boolean
  completed: boolean
  superseded: boolean
  onApprove: () => void
}) {
  const metadata = msg.metadata || {}
  const approvalStatus = String(metadata.outline_approval_status || '')
  const isSuperseded = superseded || approvalStatus === 'superseded'
  const locked = completed || isSuperseded || approvalStatus === 'approved'
  const type = String(metadata.outline_artifact_type || metadata.artifact_type || '')
  const label = type === 'lab' ? 'Lab Outline' : type === 'quiz' ? 'Assessment Configuration' : type === 'course_blueprint' ? 'Course Plan Outline' : 'Lesson Plan Outline'
  const Icon = type === 'lab' ? FlaskConical : type === 'quiz' ? FileQuestion : BookOpen
  return (
    <div className="overflow-hidden rounded-lg border border-violet-200/80 bg-white/75 shadow-sm backdrop-blur-sm">
      <div className="flex items-center gap-3 border-b border-violet-100 bg-violet-50/40 px-4 py-3.5">
        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-violet-100 text-violet-700">
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <div className="text-xs font-semibold uppercase tracking-wide text-violet-700">{label}</div>
          <div className="truncate font-semibold text-slate-900">{String(metadata.outline_title || metadata.artifact_title || '')}</div>
        </div>
      </div>
      {/* metadata carries web_sources — without it every citation in the
          outline would be unresolvable and get dropped. */}
      <div className="px-5 py-4"><ResponseMarkdown content={msg.content} streaming={false} metadata={msg.metadata} /></div>
      <div className="flex flex-col gap-2 border-t border-slate-200/80 bg-slate-50/50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs leading-5 text-slate-500">Reply with changes to revise the outline before generation.</p>
        <Button type="button" disabled={disabled || locked} onClick={onApprove} className="flex-shrink-0">
          {completed
            ? 'Full preview generated'
            : isSuperseded
              ? 'Outline revision requested'
            : approvalStatus === 'approved'
              ? 'Outline approved'
              : disabled
                ? 'Generating full preview...'
                : type === 'course_blueprint' ? 'Approve and generate course plan' : 'Approve and generate full preview'}
        </Button>
      </div>
    </div>
  )
}

export function isGeneratedArtifactPreviewMessage(msg: ChatMessage, isPending: boolean) {
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

  return explicitCard || (isArtifactType && isExportablePreview)
}

export function ArtifactPreviewCard({
  content,
  metadata,
}: {
  content: string
  metadata: Record<string, unknown>
}) {
  const [open, setOpen] = useState(false)
  const headingId = useId()
  const artifactType = String(metadata.artifact_type || metadata.pending_artifact_type || '')
  const isLab = artifactType === 'lab'
  const isQuiz = artifactType === 'quiz'
  const isCourseBlueprint = artifactType === 'course_blueprint'
  const isGame = artifactType === 'game'
  const label = isLab
    ? 'Lab Preview'
    : isQuiz
      ? 'Assessment Preview'
      : isCourseBlueprint
        ? 'Course Plan Preview'
        : isGame
          ? 'Study Game Preview'
        : 'Lesson Plan Preview'
  const fallbackTitle = isLab
    ? 'Generated lab preview'
    : isQuiz
      ? 'Generated assessment preview'
      : isCourseBlueprint
        ? 'Generated course plan preview'
        : isGame
          ? 'Generated study game'
        : 'Generated lesson plan preview'
  const title =
    metadataText(metadata.artifact_title) || extractFirstMarkdownHeading(content) || fallbackTitle
  const week = metadata.week || metadata.pending_artifact_week
  const weekLabel = week !== undefined && week !== null && String(week).trim()
    ? `Week ${String(week)}`
    : ''
  const summary = extractPreviewSummary(content)
  const Icon = isLab ? FlaskConical : isQuiz ? FileQuestion : isCourseBlueprint ? MapIcon : isGame ? Gamepad2 : BookOpen

  useEffect(() => {
    if (!open) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <>
      <div className="overflow-hidden rounded-xl border border-violet-200 bg-white/70 shadow-sm transition-colors hover:bg-white/80">
        <button type="button" onClick={() => setOpen(true)} aria-haspopup="dialog" className="w-full px-4 py-4 text-left">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-violet-100 text-violet-700">
              <Icon className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-xs font-semibold uppercase tracking-wide text-violet-700">{label}</span>
                {weekLabel && <span className="text-xs text-slate-500">{weekLabel}</span>}
              </div>
              <h3 className="mt-1 text-base font-semibold leading-6 text-slate-900">{title}</h3>
              {summary && <p className="mt-1.5 line-clamp-3 text-sm leading-5 text-slate-600">{summary}</p>}
              <div className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-violet-700">
                <Maximize2 className="h-4 w-4" />
                Open full preview
              </div>
            </div>
          </div>
        </button>
      </div>
      {open && createPortal(
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/55 p-2 backdrop-blur-sm sm:p-6"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setOpen(false)
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby={headingId}
            className="flex h-[96vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-white/60 bg-white shadow-2xl sm:h-auto sm:max-h-[90vh]"
          >
            <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-violet-100 bg-white/95 px-4 py-3 backdrop-blur sm:px-6">
              <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-violet-100 text-violet-700"><Icon className="h-5 w-5" /></div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-wide text-violet-700">
                  <span>{label}</span>{weekLabel && <span className="text-slate-500">{weekLabel}</span>}
                </div>
                <h2 id={headingId} className="truncate text-lg font-semibold text-slate-900">{title}</h2>
              </div>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close preview" className="rounded-full p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900"><X className="h-5 w-5" /></button>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-8 sm:py-7">
              <div className="mx-auto max-w-5xl"><ResponseMarkdown content={content} streaming={false} metadata={metadata} /></div>
            </div>
          </section>
        </div>,
        document.body,
      )}
    </>
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

/**
 * Actions under an assistant response: download, copy, sources, retry.
 *
 * Download and retry need the message to exist server-side, so both are hidden
 * while a response is still streaming (no message_id yet) — a half-written
 * answer is not worth exporting, and retrying mid-stream would race the run.
 */
function MessageActionBar({
  batchId,
  chatId,
  messageId,
  content,
  sources,
  onOpenSources,
  onRetry,
  retrying = false,
}: {
  batchId?: string
  chatId?: string
  messageId?: string
  content: string
  /** Web sources behind this response; drives the favicon stack and count. */
  sources: WebSourceMetadata[]
  onOpenSources: () => void
  onRetry?: () => void
  retrying?: boolean
}) {
  const [downloadOpen, setDownloadOpen] = useState(false)
  const [exporting, setExporting] = useState<ChatExportFormat | null>(null)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState('')
  const downloadRef = useRef<HTMLDivElement>(null)

  const canExport = Boolean(batchId && chatId && messageId)
  const sourceCount = sources.length
  // Three is enough to read as "several sources" without crowding the row.
  const previewSources = sources.slice(0, 3)

  useEffect(() => {
    if (!downloadOpen) return undefined
    function onPointerDown(event: MouseEvent) {
      if (downloadRef.current && !downloadRef.current.contains(event.target as Node)) {
        setDownloadOpen(false)
      }
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [downloadOpen])

  // Let "Copied" fade back to the copy icon on its own.
  useEffect(() => {
    if (!copied) return undefined
    const timer = window.setTimeout(() => setCopied(false), 1800)
    return () => window.clearTimeout(timer)
  }, [copied])

  async function handleExport(format: ChatExportFormat) {
    if (!batchId || !chatId || !messageId) return
    setExporting(format)
    setError('')
    try {
      await exportMessage(batchId, chatId, messageId, format)
      setDownloadOpen(false)
    } catch {
      setError(`Could not export as ${EXPORT_FORMAT_LABELS[format]}.`)
    } finally {
      setExporting(null)
    }
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(content)
      setCopied(true)
      setError('')
    } catch {
      setError('Could not copy to clipboard.')
    }
  }

  const iconButton =
    'inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-white/80 hover:text-violet-700 disabled:cursor-not-allowed disabled:opacity-40'

  return (
    <div className="mt-3">
      <div className="flex items-center gap-1">
        {canExport && (
          <div className="relative" ref={downloadRef}>
            <button
              type="button"
              onClick={() => setDownloadOpen((open) => !open)}
              className={iconButton}
              aria-label="Download this response"
              aria-expanded={downloadOpen}
            >
              {exporting ? <Spinner size={14} /> : <Download className="h-4 w-4" />}
            </button>
            {downloadOpen && (
              <div className="absolute bottom-full left-0 z-30 mb-2 w-44 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-xl">
                {EXPORT_FORMATS.map((format) => {
                  const FormatIcon = EXPORT_FORMAT_ICONS[format]
                  return (
                    <button
                      key={format}
                      type="button"
                      disabled={exporting !== null}
                      onClick={() => void handleExport(format)}
                      className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs text-slate-600 hover:bg-violet-50 hover:text-slate-900 disabled:opacity-50"
                    >
                      {exporting === format ? (
                        <Spinner size={14} />
                      ) : (
                        <FormatIcon className="h-3.5 w-3.5 text-violet-600" />
                      )}
                      Export as {EXPORT_FORMAT_LABELS[format]}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )}

        <button
          type="button"
          onClick={() => void handleCopy()}
          className={iconButton}
          aria-label={copied ? 'Copied to clipboard' : 'Copy this response'}
        >
          {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
        </button>

        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            disabled={retrying}
            className={iconButton}
            aria-label="Retry this request"
            title="Discard this response and ask again"
          >
            {retrying ? <Spinner size={14} /> : <RefreshCw className="h-4 w-4" />}
          </button>
        )}

        {/* Overlapping favicons then the count — the sources identify themselves,
            so the word "Sources" is redundant next to them. */}
        {sourceCount > 0 && (
          <button
            type="button"
            onClick={onOpenSources}
            className="ml-1 inline-flex items-center gap-2 rounded-full px-2 py-1.5 text-xs font-medium text-slate-500 transition-colors hover:bg-white/80 hover:text-violet-700"
            aria-label={`Show ${sourceCount} source${sourceCount === 1 ? '' : 's'}`}
          >
            {previewSources.length > 0 && (
              <span className="flex items-center">
                {previewSources.map((source, index) => (
                  <span
                    key={`${source.url || source.domain || index}`}
                    className={`inline-flex h-5 w-5 items-center justify-center overflow-hidden rounded-full border border-white bg-white shadow-sm ${
                      index > 0 ? '-ml-1.5' : ''
                    }`}
                    // stack left-over-right so the first source stays legible
                    style={{ zIndex: previewSources.length - index }}
                  >
                    <SourceFavicon
                      domain={source.domain}
                      url={source.url}
                      className="h-3.5 w-3.5 rounded-sm"
                    />
                  </span>
                ))}
              </span>
            )}
            {sourceCount} source{sourceCount === 1 ? '' : 's'}
          </button>
        )}
      </div>

      {error && <p className="mt-1 text-[11px] text-red-600">{error}</p>}
    </div>
  )
}

export function ResponseMarkdown({
  content,
  streaming,
  metadata,
  batchId,
  chatId,
  messageId,
  onRetry,
  retrying,
}: {
  content: string
  streaming: boolean
  metadata?: Record<string, unknown>
  batchId?: string
  chatId?: string
  messageId?: string
  onRetry?: () => void
  retrying?: boolean
}) {
  const [sourcesOpen, setSourcesOpen] = useState(false)
  const [selectedSource, setSelectedSource] = useState<WebSourceMetadata | null>(null)
  const { body, sources } = splitSourcesSection(content)
  const webSources = normalizeWebSources(metadata)
  const citations = normalizeWebCitations(metadata)
  const webQueries = normalizeWebQueries(metadata)

  return (
    <div className="animate-in fade-in duration-300">
      {streaming && (
        <div className="mb-1 inline-flex items-center gap-2 text-xs font-medium text-slate-500">
          <span className="h-1.5 w-1.5 rounded-full bg-violet-400 animate-pulse" />
          Generating...
        </div>
      )}
      <MarkdownBlock content={body || content} webSources={webSources} onCitationSelect={setSelectedSource} />
      {/* Actions only once the answer has settled: a streaming response has no
          message_id to export, and retrying mid-run would race it. */}
      {!streaming && (
        <MessageActionBar
          batchId={batchId}
          chatId={chatId}
          messageId={messageId}
          content={content}
          sources={webSources}
          onOpenSources={() => setSourcesOpen(true)}
          onRetry={onRetry}
          retrying={retrying}
        />
      )}
      {sourcesOpen && <SourcesModal queries={webQueries} sources={webSources} citations={citations} markdownSources={sources} onClose={() => setSourcesOpen(false)} />}
      {selectedSource && <CitationSourceModal source={selectedSource} citedText={citations.find((citation) => citation.source_index === selectedSource.index)?.cited_text || ''} onClose={() => setSelectedSource(null)} />}
    </div>
  )
}

export function WebSourcesList({
  sources,
  citations,
  hasMarkdownSources,
}: {
  sources: WebSourceMetadata[]
  citations: ReturnType<typeof normalizeWebCitations>
  hasMarkdownSources: boolean
}) {
  return (
    <div className={hasMarkdownSources ? 'mt-3 border-t border-slate-200 pt-3' : ''}>
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Web Sources</div>
      <ol className="space-y-2">
        {sources.map((source) => {
          const citedText = citations.find((citation) => citation.source_index === source.index)?.cited_text
          const visibleDomain = source.display_domain || source.domain
          const supportText = source.supports || citedText || ''
          const isGroundedLink = source.link_type === 'google_grounding_redirect'
          return (
            <li key={source.url} className="flex gap-2 rounded-xl border border-white/50 bg-white/40 p-2.5 text-xs leading-5 shadow-sm backdrop-blur-md">
              <span className="font-semibold text-slate-400">[{source.index}]</span>
              <SourceFavicon domain={visibleDomain} url={source.url} className="mt-0.5 h-4 w-4 flex-shrink-0 rounded-sm" />
              <div className="min-w-0">
                <div className="font-medium text-slate-800">{source.title}</div>
                {visibleDomain && <div className="truncate text-slate-500">{visibleDomain}{isGroundedLink && <span className="ml-1 text-slate-400">· Google grounded link</span>}</div>}
                {supportText && <div className="text-slate-600 line-clamp-2">{supportText}</div>}
                <a href={source.url} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 rounded-md border border-white/60 bg-white/40 px-2 py-1 font-medium text-slate-600 shadow-sm backdrop-blur-md transition-colors hover:bg-white/70"><ExternalLink className="h-3 w-3" />Open source</a>
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

export function CitationSourceModal({ source, citedText, onClose }: { source: WebSourceMetadata; citedText: string; onClose: () => void }) {
  useModalLifecycle(onClose)
  const supportText = source.supports || citedText
  const visibleDomain = source.display_domain || source.domain
  return createPortal(<div className="fixed inset-0 z-[360] flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={`Source ${source.index}`} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><div className="w-full max-w-md rounded-2xl border border-white/60 bg-white/80 p-5 shadow-2xl backdrop-blur-xl"><div className="flex items-start justify-between gap-3"><div><div className="text-xs font-semibold uppercase tracking-wide text-violet-700">Source [{source.index}]</div><h2 className="mt-1 text-lg font-semibold text-slate-900">{source.title}</h2>{visibleDomain && <p className="mt-1 flex items-center gap-1.5 text-sm text-slate-500"><SourceFavicon domain={visibleDomain} url={source.url} className="h-4 w-4 flex-shrink-0 rounded-sm" />{visibleDomain}</p>}</div><button type="button" onClick={onClose} className="rounded-full p-2 text-slate-500 hover:bg-slate-100" aria-label="Close source popup"><X className="h-4 w-4" /></button></div>{supportText && <p className="mt-4 text-sm leading-6 text-slate-600">{supportText}</p>}{source.link_type === 'google_grounding_redirect' && <p className="mt-3 text-xs text-slate-400">Google grounded link</p>}<a href={source.url} target="_blank" rel="noreferrer" className="mt-5 inline-flex items-center gap-2 rounded-lg bg-violet-600 px-3.5 py-2 text-sm font-semibold text-white hover:bg-violet-700"><ExternalLink className="h-4 w-4" />Open source</a></div></div>, document.body)
}

export function SourcesModal({ queries, sources, citations, markdownSources, onClose }: { queries: string[]; sources: WebSourceMetadata[]; citations: ReturnType<typeof normalizeWebCitations>; markdownSources: string; onClose: () => void }) {
  useModalLifecycle(onClose)
  return createPortal(<div className="fixed inset-0 z-[350] flex items-center justify-center bg-slate-950/50 p-3 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Web Sources" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"><header className="flex items-center justify-between border-b border-slate-200 px-5 py-4"><div><h2 className="text-lg font-semibold text-slate-900">Web Sources</h2><p className="text-sm text-slate-500">Sources captured during this response.</p></div><button type="button" onClick={onClose} className="rounded-full p-2 text-slate-500 hover:bg-slate-100" aria-label="Close Web Sources"><X className="h-5 w-5" /></button></header><div className="min-h-0 flex-1 overflow-y-auto p-5">{queries.length > 0 && <section className="mb-5"><h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Search queries</h3><div className="flex flex-wrap gap-2">{queries.map((query) => <span key={query} className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-600">{query}</span>)}</div></section>}{sources.length > 0 && <WebSourcesList sources={sources} citations={citations} hasMarkdownSources={false} />}{markdownSources && <section className={`${sources.length > 0 ? 'mt-5 border-t border-slate-200 pt-5' : ''}`}><MarkdownBlock content={markdownSources} /></section>}</div></section></div>, document.body)
}

function useModalLifecycle(onClose: () => void) {
  useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', close)
    return () => { document.body.style.overflow = previous; window.removeEventListener('keydown', close) }
  }, [onClose])
}

// KaTeX (rehype-katex) emits <span>/MathML/SVG markup that rehype-sanitize would
// otherwise strip. Extend the default schema to let its output through while still
// sanitizing everything else. className is needed everywhere (KaTeX is class-driven);
// inline style/SVG attrs are scoped to the tags KaTeX actually uses.
const MATHML_TAGS = [
  'math', 'semantics', 'annotation', 'annotation-xml', 'mrow', 'mi', 'mn', 'mo', 'ms',
  'mtext', 'mspace', 'msup', 'msub', 'msubsup', 'mfrac', 'mroot', 'msqrt', 'mtable',
  'mtr', 'mtd', 'mlabeledtr', 'munder', 'mover', 'munderover', 'mpadded', 'mphantom',
  'menclose', 'mstyle', 'mglyph', 'malignmark', 'maligngroup', 'mfenced', 'merror',
  'mmultiscripts', 'mprescripts', 'none',
]

const katexSanitizeSchema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), 'span', 'svg', 'path', 'line', ...MATHML_TAGS],
  attributes: {
    ...defaultSchema.attributes,
    '*': [...(defaultSchema.attributes?.['*'] ?? []), 'className', 'style', 'ariaHidden'],
    svg: ['xmlns', 'width', 'height', 'viewBox', 'preserveAspectRatio', 'style'],
    path: ['d'],
    line: ['x1', 'y1', 'x2', 'y2', 'stroke', 'strokeWidth'],
    math: ['xmlns', 'display'],
    annotation: ['encoding'],
  },
}

export function MarkdownBlock({ content, webSources = [], onCitationSelect }: { content: string; webSources?: WebSourceMetadata[]; onCitationSelect?: (source: WebSourceMetadata) => void }) {
  const sourceByIndex = new Map(webSources.map((source) => [source.index, source]))
  const sourceByUrl = new Map(webSources.map((source) => [source.url, source]))
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath, citationRemarkPlugin(sourceByIndex)]}
      rehypePlugins={[rehypeKatex, [rehypeSanitize, katexSanitizeSchema]]}
      components={{
        h1: ({ ...props }) => <h1 className="mb-4 mt-2 border-b border-slate-200 pb-2 text-2xl font-bold text-slate-950" {...props} />,
        h2: ({ ...props }) => <h2 className="mb-2 mt-7 text-xl font-semibold text-slate-900" {...props} />,
        h3: ({ ...props }) => <h3 className="mb-2 mt-5 text-base font-semibold text-violet-900" {...props} />,
        p: ({ ...props }) => <p className="my-3 leading-7" {...props} />,
        ul: ({ ...props }) => <ul className="my-3 list-disc space-y-1.5 pl-6" {...props} />,
        ol: ({ ...props }) => <ol className="my-3 list-decimal space-y-1.5 pl-6" {...props} />,
        li: ({ ...props }) => <li className="pl-1" {...props} />,
        a: ({ href, children, ...props }) => {
          const source = href ? sourceByUrl.get(href) : undefined
          const isCitation = Boolean(source && /^\[\d+\]$/.test(String(children)))
          if (isCitation && source) {
            const chipLabel = source.display_domain || source.domain || source.title
            return (
              <button
                type="button"
                onClick={() => onCitationSelect?.(source)}
                className="mx-0.5 inline-flex max-w-[14rem] items-center gap-1 rounded-full border border-white/60 bg-white/40 px-1.5 py-0.5 align-baseline text-xs font-medium text-slate-700 no-underline shadow-sm backdrop-blur-md transition-colors hover:bg-white/70"
                title={`${source.title} — ${source.display_domain || source.domain}`}
              >
                <SourceFavicon domain={source.display_domain || source.domain} url={source.url} className="h-3 w-3 flex-shrink-0 rounded-sm" />
                <span className="truncate">{chipLabel}</span>
              </button>
            )
          }
          return (
            <a
              href={href}
              className="break-words font-medium text-violet-700 underline underline-offset-2 hover:text-violet-800"
              target="_blank"
              rel="noreferrer"
              {...props}
            >{children}</a>
          )
        },
        table: ({ ...props }) => (
          <div className="my-3 max-w-full overflow-x-auto rounded-lg border border-slate-200">
            <table className="min-w-full border-collapse divide-y divide-slate-200 text-sm" {...props} />
          </div>
        ),
        th: ({ ...props }) => <th className="bg-violet-50 px-3 py-2.5 text-left font-semibold text-violet-950" {...props} />,
        td: ({ ...props }) => <td className="border-t border-slate-100 px-3 py-2.5 align-top leading-6" {...props} />,
        code: ({ className, children, ...props }) => {
          if (!String(children).trim()) return null
          const isBlock = /language-/.test(className || '') || String(children).includes('\n')
          return isBlock ? (
            <code className={`${className || 'language-text'} block font-mono text-[13px] leading-6`} {...props}>
              {children}
            </code>
          ) : (
            <code className="rounded bg-slate-100 px-1.5 py-0.5 text-[0.92em] text-slate-800" {...props}>
              {children}
            </code>
          )
        },
        pre: ({ ...props }) => (
          <pre className="my-4 max-w-full overflow-x-auto whitespace-pre rounded-xl border border-slate-800 bg-slate-950 px-4 py-4 font-mono text-slate-100 shadow-sm" {...props} />
        ),
        blockquote: ({ ...props }) => (
          <blockquote className="my-4 rounded-r-lg border-l-4 border-violet-400 bg-violet-50/80 px-4 py-2 text-violet-950" {...props} />
        ),
      }}
    >
      {content}
    </ReactMarkdown>
  )
}

export function BlueprintSaveButton({ batchId, msg, onSaved }: { batchId: string; msg: ChatMessage; onSaved?: (version: number | null) => void }) {
  const metadata = msg.metadata || {}
  const savable = metadata.pending_savable_blueprint === true
  const alreadySavedId = String(metadata.course_blueprint_saved_id || '')
  const runId = String(msg.run_id || '')
  const chatId = msg.chat_id
  const [saving, setSaving] = useState(false)
  const [savedVersion, setSavedVersion] = useState<number | null>(null)
  const [error, setError] = useState('')

  if (!savable && !alreadySavedId) return null
  const isSaved = Boolean(alreadySavedId) || savedVersion !== null

  async function handleSave() {
    if (!chatId || !runId) return
    setError('')
    setSaving(true)
    try {
      const res = await saveBlueprintFromRun(batchId, chatId, runId)
      setSavedVersion(res.version ?? null)
      onSaved?.(res.version ?? null)
    } catch {
      setError('Could not save the course plan. Please retry.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mt-2">
      {isSaved ? (
        <span className="inline-flex items-center gap-1.5 text-sm font-medium text-violet-700">
          <Save className="h-4 w-4" /> Saved as course plan{savedVersion ? ` (v${savedVersion})` : ''}
        </span>
      ) : (
        <Button type="button" onClick={handleSave} loading={saving} disabled={!chatId || !runId} size="sm">
          <Save className="h-4 w-4" />
          Save as course plan
        </Button>
      )}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  )
}

export function GameCreateButton({ batchId, msg }: { batchId: string; msg: ChatMessage }) {
  const metadata = msg.metadata || {}
  const savable = metadata.pending_savable_game === true
  const runId = String(msg.run_id || '')
  const chatId = msg.chat_id
  const contentHash = String(metadata.pending_artifact_content_hash || '')
  const itemCount =
    typeof metadata.game_item_count === 'number' ? metadata.game_item_count : 0

  const [creating, setCreating] = useState(false)
  const [created, setCreated] = useState<{ gameId: string; itemCount: number } | null>(null)
  const [error, setError] = useState('')

  if (!savable && !created) return null

  async function handleCreate() {
    if (!chatId || !runId) return
    setError('')
    setCreating(true)
    try {
      const game = await createGameFromRun(batchId, chatId, runId, contentHash)
      setCreated({ gameId: game.gameId, itemCount: game.itemCount })
    } catch (err) {
      const maybe = err as { response?: { data?: { detail?: unknown } }; message?: string }
      const detail = maybe.response?.data?.detail
      setError(
        typeof detail === 'string' ? detail : maybe.message || 'Could not create the game. Please retry.',
      )
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="mt-2">
      {created ? (
        <span className="inline-flex items-center gap-1.5 text-sm font-medium text-violet-700">
          <Gamepad2 className="h-4 w-4" />
          Game created{created.itemCount ? ` · ${created.itemCount} pairs` : ''}
        </span>
      ) : (
        <Button type="button" onClick={handleCreate} loading={creating} disabled={!chatId || !runId} size="sm">
          <Gamepad2 className="h-4 w-4" />
          Create game{itemCount ? ` (${itemCount} pairs)` : ''}
        </Button>
      )}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  )
}

function minScheduleLocalValue(): string {
  const d = new Date(Date.now() + 60_000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function formatMaybeDate(value: string): string {
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString()
}

export function EmailActionButtons({ batchId, msg }: { batchId: string; msg: ChatMessage }) {
  const metadata = msg.metadata || {}
  const sendable = metadata.pending_email_sendable === true
  const alreadySent = metadata.email_sent === true
  const alreadyScheduled = metadata.email_scheduled === true
  const runId = String(msg.run_id || '')
  const chatId = msg.chat_id
  const recipientCount =
    typeof metadata.email_recipient_count === 'number' ? metadata.email_recipient_count : 0

  const [busy, setBusy] = useState<'send' | 'schedule' | 'edit' | null>(null)
  const [showSchedule, setShowSchedule] = useState(false)
  const [sendAt, setSendAt] = useState('')
  const [showEdit, setShowEdit] = useState(false)
  const [draft, setDraft] = useState({
    subject: String(metadata.email_subject || ''),
    body: String(metadata.email_body || ''),
  })
  const [done, setDone] = useState<{ kind: 'sent' | 'scheduled'; detail: string } | null>(
    alreadySent
      ? { kind: 'sent', detail: '' }
      : alreadyScheduled
        ? { kind: 'scheduled', detail: String(metadata.email_send_at || '') }
        : null,
  )
  const [needsGoogle, setNeedsGoogle] = useState(false)
  const [error, setError] = useState('')

  if ((!sendable && !done) || !chatId || !runId) return null

  function onError(err: unknown) {
    const maybe = err as { response?: { data?: { detail?: unknown } }; message?: string }
    const detail = maybe.response?.data?.detail
    if (detail && typeof detail === 'object' && 'code' in detail) {
      if (String((detail as { code?: unknown }).code || '') === 'GOOGLE_OAUTH_REQUIRED') {
        setNeedsGoogle(true)
        return
      }
    }
    setError(typeof detail === 'string' ? detail : maybe.message || 'Email action failed.')
  }

  async function handleSend() {
    setError('')
    setNeedsGoogle(false)
    setBusy('send')
    try {
      const res = await sendPendingEmail(batchId, chatId, runId)
      const failed = res.failed_count || 0
      setDone({
        kind: 'sent',
        detail:
          failed > 0
            ? `${res.sent_count} sent, ${failed} failed`
            : `${res.sent_count} recipient${res.sent_count === 1 ? '' : 's'}`,
      })
    } catch (err) {
      onError(err)
    } finally {
      setBusy(null)
    }
  }

  async function handleSaveEdit() {
    if (!draft.subject.trim() || !draft.body.trim()) {
      setError('Subject and body are required.')
      return
    }
    setError('')
    setBusy('edit')
    try {
      await updatePendingEmail(batchId, chatId, runId, {
        subject: draft.subject,
        body: draft.body,
      })
      setShowEdit(false)
    } catch (err) {
      onError(err)
    } finally {
      setBusy(null)
    }
  }

  async function handleSchedule() {
    if (!sendAt) {
      setError('Choose a date and time.')
      return
    }
    if (new Date(sendAt) <= new Date()) {
      setError('Scheduled time must be in the future.')
      return
    }
    setError('')
    setNeedsGoogle(false)
    setBusy('schedule')
    try {
      const res = await schedulePendingEmail(batchId, chatId, runId, new Date(sendAt).toISOString())
      setDone({ kind: 'scheduled', detail: res.send_at })
      setShowSchedule(false)
    } catch (err) {
      onError(err)
    } finally {
      setBusy(null)
    }
  }

  if (done) {
    return (
      <div className="mt-3 border-t border-slate-200 pt-3">
        <span className="inline-flex items-center gap-1.5 text-sm font-medium text-violet-700">
          <Mail className="h-4 w-4" />
          {done.kind === 'sent'
            ? `Email sent${done.detail ? ` — ${done.detail}` : ''}`
            : `Email scheduled${done.detail ? ` for ${formatMaybeDate(done.detail)}` : ''}`}
        </span>
      </div>
    )
  }

  return (
    <div className="mt-3 flex flex-col gap-2 border-t border-slate-200 pt-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void handleSend()}
          disabled={busy !== null}
          className="inline-flex items-center gap-2 rounded-md bg-violet-600 px-3 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-70"
        >
          {busy === 'send' ? <Spinner tone="inverse" size={16} /> : <Send className="h-4 w-4" />}
          {busy === 'send' ? 'Sending…' : `Send now${recipientCount ? ` (${recipientCount})` : ''}`}
        </button>
        <button
          type="button"
          onClick={() => {
            setShowEdit((s) => !s)
            setShowSchedule(false)
            setError('')
          }}
          disabled={busy !== null}
          className="inline-flex items-center gap-2 rounded-md border border-violet-200 bg-white px-3 py-2 text-sm font-medium text-violet-700 hover:bg-violet-50 disabled:opacity-70"
        >
          <Pencil className="h-4 w-4" />
          {showEdit ? 'Cancel edit' : 'Edit'}
        </button>
        <button
          type="button"
          onClick={() => {
            setShowSchedule((s) => !s)
            setError('')
            if (!sendAt) setSendAt(minScheduleLocalValue())
          }}
          disabled={busy !== null}
          className="inline-flex items-center gap-2 rounded-md border border-violet-200 bg-white px-3 py-2 text-sm font-medium text-violet-700 hover:bg-violet-50 disabled:opacity-70"
        >
          <CalendarClock className="h-4 w-4" />
          Schedule
        </button>
        {needsGoogle && (
          <button
            type="button"
            onClick={startGoogleOAuth}
            className="inline-flex items-center rounded-md border border-violet-200 bg-white px-3 py-2 text-sm font-medium text-violet-700 hover:bg-violet-50"
          >
            Connect Google
          </button>
        )}
      </div>
      {showEdit && (
        <div className="flex flex-col gap-2 rounded-lg border border-violet-100 bg-violet-50/60 p-3">
          <label className="text-xs font-semibold text-slate-600">
            Subject
            <input
              type="text"
              value={draft.subject}
              onChange={(e) => setDraft((d) => ({ ...d, subject: e.target.value }))}
              disabled={busy !== null}
              className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal text-slate-800 focus:border-violet-500 focus:ring-violet-500 disabled:opacity-60"
            />
          </label>
          <label className="text-xs font-semibold text-slate-600">
            Body
            <textarea
              rows={8}
              value={draft.body}
              onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))}
              disabled={busy !== null}
              className="mt-1 block w-full resize-y rounded-md border border-slate-300 px-3 py-2 text-sm font-normal text-slate-800 focus:border-violet-500 focus:ring-violet-500 disabled:opacity-60"
            />
          </label>
          <p className="text-[11px] text-slate-500">
            Sending to {recipientCount} recipient{recipientCount === 1 ? '' : 's'}.
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void handleSaveEdit()}
              disabled={busy !== null}
              className="inline-flex items-center gap-2 rounded-md bg-violet-600 px-3 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-70"
            >
              {busy === 'edit' ? <Spinner tone="inverse" size={16} /> : null}
              {busy === 'edit' ? 'Saving…' : 'Save changes'}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowEdit(false)
                setDraft({
                  subject: String(metadata.email_subject || ''),
                  body: String(metadata.email_body || ''),
                })
                setError('')
              }}
              disabled={busy !== null}
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-70"
            >
              Discard
            </button>
          </div>
        </div>
      )}
      {showSchedule && (
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="datetime-local"
            min={minScheduleLocalValue()}
            value={sendAt}
            onChange={(e) => setSendAt(e.target.value)}
            className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          />
          <button
            type="button"
            onClick={() => void handleSchedule()}
            disabled={busy !== null}
            className="inline-flex items-center gap-2 rounded-md bg-violet-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-70"
          >
            {busy === 'schedule' ? (
              <Spinner tone="inverse" size={16} />
            ) : (
              <CalendarClock className="h-4 w-4" />
            )}
            Confirm schedule
          </button>
        </div>
      )}
      {error && <span className="text-sm text-red-600">{error}</span>}
    </div>
  )
}

export function ArtifactExportButton({
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
          className="inline-flex items-center gap-2 rounded-md bg-violet-600 px-3 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {exporting ? (
            <Spinner tone="inverse" size={16} />
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
          className="inline-flex items-center rounded-md border border-violet-200 bg-white px-3 py-2 text-sm font-medium text-violet-700 hover:bg-violet-50"
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
      className="inline-flex items-center gap-2 rounded-md bg-violet-600 px-3 py-2 text-sm font-medium text-white hover:bg-violet-700"
    >
      <ExternalLink className="h-4 w-4" />
      {label}
    </a>
  )
}

/**
 * Shown while an assistant message is pending with no content yet.
 *
 * The bot avatar and the bouncing-dots bubble are both gone; what remains is
 * the MILA garland on its own. It is the same mark the thinking rows use, so
 * "the agent is working" reads identically wherever it appears.
 */
export function ThinkingIndicator() {
  return (
    <div className="py-1">
      <ThinkingRow label="Thinking…" size={32} />
    </div>
  )
}
