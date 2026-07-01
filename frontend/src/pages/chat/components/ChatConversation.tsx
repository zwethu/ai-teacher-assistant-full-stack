import { useEffect, useRef, useState, type RefObject } from 'react'
import type { ChangeEvent, ClipboardEvent, KeyboardEvent } from 'react'
import type { ChatMessage } from '../../../entity/Chat'
import { BookOpen, FileQuestion, FileText, FlaskConical, History, Image as ImageIcon, Loader2, Paperclip, Send, Sparkles, X } from 'lucide-react'
import { MessageRow, ThinkingIndicator } from './MessageRow'
import { ConnectorToggles, type ConnectorsState } from './ConnectorToggles'
import type { RunUiState } from '../runTypes'
import type { PendingChatAttachment } from '../hooks/useChatPage'
import type { ChatAttachmentListItem, ChatAttachmentSnapshot } from '../../../entity/Chat'
import { getChatAttachmentContent, listChatAttachments } from '../../../services/chatService'

export type GenerateMode = 'lesson_plan' | 'lab' | 'assessment'

type Props = {
  input: string
  sending: boolean
  disabled?: boolean
  dimmed?: boolean
  textareaRef: RefObject<HTMLTextAreaElement | null>
  onInputChange: (value: string) => void
  onInputKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => void
  onTextareaInput: () => void
  onSend: () => void
  connectors: ConnectorsState
  onConnectorsChange: (key: keyof ConnectorsState, value: boolean) => void
  activeGenerateMode: GenerateMode | null
  onSelectGenerateMode: (mode: GenerateMode) => void
  onClearGenerateMode: () => void
  pendingAttachments: PendingChatAttachment[]
  attachmentsUploading: boolean
  attachmentErrors: string[]
  onAttachmentFiles: (e: ChangeEvent<HTMLInputElement>) => void
  onRemoveAttachment: (attachmentId: string) => void
  onPaste: (e: ClipboardEvent<HTMLTextAreaElement>) => void
  batchId?: string
  chatId?: string
}

export function ChatInput({
  input,
  sending,
  disabled = false,
  dimmed = false,
  textareaRef,
  onInputChange,
  onInputKeyDown,
  onTextareaInput,
  onSend,
  connectors,
  onConnectorsChange,
  activeGenerateMode,
  onSelectGenerateMode,
  onClearGenerateMode,
  pendingAttachments,
  attachmentsUploading,
  attachmentErrors,
  onAttachmentFiles,
  onRemoveAttachment,
  onPaste,
  batchId,
  chatId,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false)
  const attachmentInputRef = useRef<HTMLInputElement>(null)

  function selectGenerateMode(mode: GenerateMode) {
    onSelectGenerateMode(mode)
    setMenuOpen(false)
    requestAnimationFrame(() => textareaRef.current?.focus())
  }

  const modeLabel = activeGenerateMode === 'lab'
    ? 'Lab Preview'
    : activeGenerateMode === 'assessment'
      ? 'Assessment Preview'
      : 'Lesson Plan Preview'
  const placeholder =
    activeGenerateMode === 'lesson_plan'
      ? 'Describe the lesson plan preview you want, e.g. Week 1 intro to Power BI...'
      : activeGenerateMode === 'lab'
        ? 'Describe the lab preview you want, e.g. Week 3 Firebase guestbook lab...'
        : activeGenerateMode === 'assessment'
          ? 'Describe the assessment preview you want, e.g. Week 3 mixed quiz, 10 questions...'
        : 'Message your teaching assistant...'

  return (
    <footer
      className={`relative z-10 px-4 pb-5 pt-2 bg-gradient-to-t from-white/60 via-white/30 to-transparent backdrop-blur-sm flex-shrink-0 transition-opacity ${
        dimmed ? 'opacity-40 pointer-events-none' : ''
      }`}
    >
      <div className="max-w-3xl mx-auto">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen((value) => !value)}
              disabled={disabled || sending}
              className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-white/75 px-3 py-1.5 text-sm font-medium text-emerald-700 shadow-sm hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Sparkles className="h-4 w-4" />
              Generate
            </button>
            {menuOpen && (
              <div className="absolute bottom-full left-0 z-30 mb-2 w-56 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl">
                <button
                  type="button"
                  onClick={() => selectGenerateMode('lesson_plan')}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-emerald-50"
                >
                  <BookOpen className="h-4 w-4 text-emerald-600" />
                  Lesson Plan Preview
                </button>
                <button
                  type="button"
                  onClick={() => selectGenerateMode('lab')}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-emerald-50"
                >
                  <FlaskConical className="h-4 w-4 text-emerald-600" />
                  Lab Preview
                </button>
                <button
                  type="button"
                  onClick={() => selectGenerateMode('assessment')}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-emerald-50"
                >
                  <FileQuestion className="h-4 w-4 text-emerald-600" />
                  Assessment Preview
                </button>
              </div>
            )}
          </div>
          <ConnectorToggles
            connectors={connectors}
            onChange={onConnectorsChange}
            disabled={disabled || sending}
          />
        </div>
        {activeGenerateMode && (
          <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50/90 px-3 py-1.5 text-sm font-medium text-emerald-800 shadow-sm">
            {activeGenerateMode === 'lab' ? (
              <FlaskConical className="h-4 w-4" />
            ) : activeGenerateMode === 'assessment' ? (
              <FileQuestion className="h-4 w-4" />
            ) : (
              <BookOpen className="h-4 w-4" />
            )}
            <span>{modeLabel}</span>
            <button
              type="button"
              onClick={onClearGenerateMode}
              className="inline-flex h-5 w-5 items-center justify-center rounded-full text-emerald-700 hover:bg-emerald-100"
              aria-label={`Clear ${modeLabel}`}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
        {pendingAttachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {pendingAttachments.map((attachment) => (
              <div key={attachment.attachment_id} className="flex max-w-xs items-center gap-2 rounded-xl border border-slate-200 bg-white/90 p-2 shadow-sm">
                {attachment.attachment_kind === 'image' && attachment.previewUrl ? (
                  <img src={attachment.previewUrl} alt="" className="h-10 w-10 rounded-lg object-cover" />
                ) : attachment.attachment_kind === 'image' ? (
                  <ImageIcon className="h-5 w-5 text-sky-600" />
                ) : (
                  <FileText className="h-5 w-5 text-emerald-600" />
                )}
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium text-slate-700">{attachment.file_name}</p>
                  <p className="text-[11px] text-slate-400" title={attachment.attachment_kind === 'image' && attachment.vision_status !== 'ready' ? 'Image analysis is unavailable; the assistant will not guess its contents.' : undefined}>
                    {(attachment.size_bytes / 1024 / 1024).toFixed(1)} MB
                    {attachment.attachment_kind === 'image' ? ` · chat-only · vision ${attachment.vision_status}` : ` · ${attachment.parse_status}`}
                  </p>
                </div>
                <button type="button" onClick={() => onRemoveAttachment(attachment.attachment_id)} className="rounded p-1 text-slate-400 hover:bg-slate-100" aria-label={`Remove ${attachment.file_name}`}>
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
        {attachmentErrors.map((error) => <p key={error} className="mb-1 text-xs text-red-600">{error}</p>)}
        {batchId && chatId && <PreviousAttachments batchId={batchId} chatId={chatId} onReference={(attachment) => {
          const mention = `Please use the earlier attachment ${attachment.file_name}. Attachment ID: ${attachment.attachment_id}`
          onInputChange(input.trim() ? `${input.trim()}\n${mention}` : mention)
          requestAnimationFrame(() => textareaRef.current?.focus())
        }} />}
        <div className="flex items-end gap-2 p-2 rounded-[28px] bg-white/55 border border-white/60 shadow-[0_8px_32px_rgba(15,23,42,0.08)]">
          <input
            ref={attachmentInputRef}
            type="file"
            multiple
            accept=".pdf,.docx,.pptx,.txt,.md,.markdown,.csv,.png,.jpg,.jpeg,.webp,.heic,.heif"
            onChange={onAttachmentFiles}
            disabled={disabled || sending || attachmentsUploading}
            className="sr-only"
          />
          <button
            type="button"
            onClick={() => attachmentInputRef.current?.click()}
            disabled={disabled || sending || attachmentsUploading || pendingAttachments.length >= 5}
            className="mb-0.5 ml-1 inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-slate-500 hover:bg-white/80 disabled:opacity-40"
            aria-label="Attach files"
          >
            {attachmentsUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
          </button>
          <textarea
            ref={textareaRef}
            rows={1}
            value={input}
            onChange={(e) => onInputChange(e.target.value)}
            onInput={onTextareaInput}
            onKeyDown={onInputKeyDown}
            onPaste={onPaste}
            placeholder={placeholder}
            disabled={disabled || sending}
            className="flex-1 resize-none bg-transparent px-4 py-3 text-[15px] text-slate-800 placeholder:text-slate-400 focus:outline-none disabled:cursor-not-allowed max-h-40 overflow-y-auto leading-6"
          />
          <button
            type="button"
            onClick={onSend}
            disabled={(!input.trim() && pendingAttachments.length === 0) || disabled || sending || attachmentsUploading}
            className="flex-shrink-0 inline-flex items-center justify-center w-10 h-10 mb-0.5 mr-1 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white shadow-md shadow-emerald-600/25 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
            aria-label="Send message"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
        <p className="mt-2.5 text-center text-xs text-slate-400">
          Enter to send · Shift+Enter for new line
        </p>
      </div>
    </footer>
  )
}

function PreviousAttachments({ batchId, chatId, onReference }: { batchId: string; chatId: string; onReference: (attachment: ChatAttachmentListItem) => void }) {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<ChatAttachmentListItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({})
  const thumbnailUrlsRef = useRef<string[]>([])

  useEffect(() => () => thumbnailUrlsRef.current.forEach((url) => URL.revokeObjectURL(url)), [])

  async function toggle() {
    const next = !open; setOpen(next)
    if (!next || items.length) return
    setLoading(true); setError('')
    try {
      const data = await listChatAttachments(batchId, chatId)
      setItems(data)
      for (const item of data.filter((value) => value.attachment_kind === 'image' && value.thumbnail_available).slice(0, 20)) {
        try {
          const blob = await getChatAttachmentContent(batchId, chatId, item.attachment_id, true)
          const url = URL.createObjectURL(blob); thumbnailUrlsRef.current.push(url)
          setThumbnails((prev) => ({ ...prev, [item.attachment_id]: url }))
        } catch { /* metadata remains usable */ }
      }
    } catch { setError('Previous attachments are unavailable.') }
    finally { setLoading(false) }
  }

  return <div className="relative mb-2">
    <button type="button" onClick={() => void toggle()} className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white/80 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-white">
      <History className="h-3.5 w-3.5" /> Previous attachments
    </button>
    {open && <div className="absolute bottom-full left-0 z-40 mb-2 max-h-72 w-80 overflow-y-auto rounded-xl border border-slate-200 bg-white p-2 shadow-xl">
      {loading ? <p className="p-3 text-xs text-slate-500">Loading attachments…</p> : error ? <p className="p-3 text-xs text-red-600">{error}</p> : items.length === 0 ? <p className="p-3 text-xs text-slate-500">No retained attachments in this chat.</p> : items.map((item) => <div key={item.attachment_id} className="flex items-center gap-2 rounded-lg p-2 hover:bg-slate-50">
        {thumbnails[item.attachment_id] ? <img src={thumbnails[item.attachment_id]} alt="" className="h-9 w-9 rounded object-cover" /> : item.attachment_kind === 'image' ? <ImageIcon className="h-5 w-5 text-sky-600" /> : <FileText className="h-5 w-5 text-emerald-600" />}
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium text-slate-700">{item.file_title || item.file_name}</p>
          <p className="text-[11px] text-slate-400">
            {item.attachment_kind === 'image' ? `vision ${item.vision_status}` : item.parse_status}
            {' · '}{(item.size_bytes / 1024 / 1024).toFixed(1)} MB
            {' · '}{item.created_at ? new Date(item.created_at).toLocaleDateString() : 'date unavailable'}
          </p>
          {item.expires_at && <p className="text-[10px] text-slate-400">Available until {new Date(item.expires_at).toLocaleDateString()}</p>}
        </div>
        <button type="button" onClick={() => { onReference(item); setOpen(false) }} className="rounded-md bg-emerald-50 px-2 py-1 text-[11px] font-medium text-emerald-700">Reference</button>
      </div>)}
    </div>}
  </div>
}

type MessagesPanelProps = {
  batchId?: string
  courseName?: string
  messages: ChatMessage[]
  messagesLoading: boolean
  showWelcome: boolean
  sending: boolean
  runStates: Record<string, RunUiState>
  messagesEndRef: RefObject<HTMLDivElement | null>
  welcomeContent: React.ReactNode
  onApproveOutline: (message: ChatMessage) => void
  onAskAboutAttachment: (attachment: ChatAttachmentSnapshot) => void
}

export function ChatMessagesPanel({
  batchId,
  courseName,
  messages,
  messagesLoading,
  showWelcome,
  sending,
  runStates,
  messagesEndRef,
  welcomeContent,
  onApproveOutline,
  onAskAboutAttachment,
}: MessagesPanelProps) {
  const safeMessages = messages.filter(Boolean)
  const completedOutlineRunIds = new Set(
    safeMessages
      .filter((message) =>
        message.role === 'assistant' &&
        !message.pending &&
        message.metadata?.workflow_stage === 'full' &&
        message.metadata?.pending_exportable === true,
      )
      .map((message) => String(message.metadata?.approved_outline_run_id || ''))
      .filter(Boolean),
  )
  const supersededOutlineRunIds = new Set(
    safeMessages.flatMap((message, index) => {
      if (
        message.role !== 'assistant' ||
        message.metadata?.workflow_stage !== 'outline' ||
        !message.run_id
      ) {
        return []
      }
      const hasLaterFollowup = safeMessages.slice(index + 1).some(
        (later) => later.role === 'user' && !isGeneratedOutlineApprovalText(later.content),
      )
      return hasLaterFollowup ? [message.run_id] : []
    }),
  )

  return (
    <main className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto px-4 py-8 min-h-full flex flex-col">
        {messagesLoading ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="w-6 h-6 text-emerald-600 animate-spin" />
          </div>
        ) : showWelcome ? (
          welcomeContent
        ) : (
          <div className="space-y-8 pb-4">
            {safeMessages.map((msg) => (
              <MessageRow
                key={msg.message_id}
                msg={msg}
                run={msg.run_id ? runStates[msg.run_id] : undefined}
                batchId={batchId}
                onApproveOutline={onApproveOutline}
                approvalDisabled={sending}
                approvalCompleted={Boolean(msg.run_id && completedOutlineRunIds.has(msg.run_id))}
                approvalSuperseded={Boolean(msg.run_id && supersededOutlineRunIds.has(msg.run_id))}
                courseName={courseName || ''}
                onAskAboutAttachment={onAskAboutAttachment}
              />
            ))}
            {sending && !safeMessages.some((msg) => msg.pending) && <ThinkingIndicator />}
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>
    </main>
  )
}

function isGeneratedOutlineApprovalText(content: string) {
  return content.trim().toLowerCase().startsWith('approve this outline and generate the full ')
}
