import { useEffect, useState } from 'react'
import { Bot, ExternalLink, FileText, Loader2, User } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import rehypeSanitize from 'rehype-sanitize'
import remarkGfm from 'remark-gfm'
import type { ChatMessage } from '../../../entity/Chat'
import { checkGoogleAuthStatus, startGoogleOAuth } from '../../../services/authService'
import {
  exportLessonPlanDraftToGoogleDocs,
  getArtifact,
  type LessonPlanExportResult,
} from '../../../services/artifactService'
import type { RunUiState } from '../runTypes'
import { RunDetails } from './run/RunDetails'
import { ThinkingPanel } from './run/ThinkingPanel'

export function MessageRow({
  msg,
  run,
  batchId,
}: {
  msg?: ChatMessage | null
  run?: RunUiState
  batchId?: string
}) {
  if (!msg) return null

  const isUser = msg.role === 'user'
  const isFinal = !msg.pending && msg.status !== 'pending'
  const isPending = msg.pending || msg.status === 'pending'
  const isFailed = msg.status === 'failed' || run?.status === 'failed'

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
                <ThinkingPanel events={run.events} runStatus={run.status} />
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
                <div className="animate-in fade-in duration-300">
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
                    {msg.content}
                  </ReactMarkdown>
                </div>
              ) : null}
            </div>
            {!isUser && batchId && <LessonPlanExportButton batchId={batchId} msg={msg} />}
          </div>
        )}
      </div>
    </div>
  )
}

function LessonPlanExportButton({
  batchId,
  msg,
}: {
  batchId: string
  msg: ChatMessage
}) {
  const metadata = msg.metadata || {}
  const artifactId = String(metadata.draft_artifact_id || '')
  const artifactType = String(metadata.artifact_type || '')
  const exportable = metadata.exportable === true
  const initialDocUrl = typeof metadata.doc_url === 'string' ? metadata.doc_url : ''
  const [checkingAuth, setCheckingAuth] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [result, setResult] = useState<LessonPlanExportResult | null>(
    initialDocUrl
      ? {
          artifact_id: artifactId,
          status: 'confirmed',
          doc_url: initialDocUrl,
          version: typeof metadata.version === 'number' ? metadata.version : undefined,
          drive_file_name:
            typeof metadata.drive_file_name === 'string' ? metadata.drive_file_name : undefined,
        }
      : null,
  )
  const [needsGoogle, setNeedsGoogle] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!artifactId || artifactType !== 'lesson_plan') return
    let cancelled = false
    getArtifact(batchId, artifactId)
      .then((artifact) => {
        if (cancelled) return
        if (artifact.status === 'confirmed' && artifact.doc_url) {
          setResult({
            artifact_id: artifact.id,
            status: artifact.status,
            doc_url: artifact.doc_url,
            doc_id: artifact.doc_id,
            version: artifact.version,
            drive_file_name: artifact.drive_file_name,
          })
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

  if (!artifactId || artifactType !== 'lesson_plan' || (!exportable && !result?.doc_url)) {
    return null
  }

  async function handleExport() {
    setError('')
    setNeedsGoogle(false)
    setCheckingAuth(true)
    try {
      const status = await checkGoogleAuthStatus()
      if (!status.valid || !status.has_google_scopes) {
        setNeedsGoogle(true)
        return
      }
    } catch {
      setNeedsGoogle(true)
      return
    } finally {
      setCheckingAuth(false)
    }

    setExporting(true)
    try {
      const exported = await exportLessonPlanDraftToGoogleDocs(batchId, artifactId)
      setResult(exported)
    } catch (err) {
      const maybe = err as { response?: { data?: { detail?: unknown } }; message?: string }
      const detail = maybe.response?.data?.detail
      if (detail && typeof detail === 'object' && 'code' in detail) {
        const code = String((detail as { code?: unknown }).code || '')
        if (code === 'GOOGLE_OAUTH_REQUIRED') {
          setNeedsGoogle(true)
          return
        }
      }
      setError(maybe.message || 'Failed to export lesson plan.')
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-200 pt-3">
      {result?.doc_url ? (
        <>
          <a
            href={result.doc_url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700"
          >
            <ExternalLink className="h-4 w-4" />
            Open Google Doc
          </a>
          <span className="text-xs text-slate-500">
            {result.drive_file_name || 'Lesson plan exported'}
            {result.version ? ` · v${String(result.version).padStart(2, '0')}` : ''}
          </span>
        </>
      ) : (
        <button
          type="button"
          onClick={() => void handleExport()}
          disabled={checkingAuth || exporting}
          className="inline-flex items-center gap-2 rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {checkingAuth || exporting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <FileText className="h-4 w-4" />
          )}
          {exporting ? 'Exporting...' : 'Export to Google Docs'}
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
