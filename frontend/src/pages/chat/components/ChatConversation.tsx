import { useEffect, useRef, useState, type RefObject } from 'react'
import type { ChangeEvent, ClipboardEvent, KeyboardEvent } from 'react'
import type { ChatMessage } from '../../../entity/Chat'
import { FileText, Globe, Image as ImageIcon, Send, Square, X } from 'lucide-react'
import { MessageRow, ThinkingIndicator } from './MessageRow'
import { type ConnectorsState } from './ConnectorToggles'
import type { RunUiState } from '../runTypes'
import type { PendingChatAttachment } from '../hooks/useChatPage'
import type { ChatAttachmentListItem, ChatAttachmentSnapshot } from '../../../entity/Chat'
import { Spinner, IconButton } from '../../../design-system'
import { AttachmentCard, AttachmentViewer, attachmentStatusLabel } from './AttachmentPreview'
import type { GenerateMode } from './ComposerSurface'
import {
  COMPOSER_TEXTAREA_CLASS,
  ComposerAddMenu,
  ComposerControls,
  ComposerHint,
  ComposerModeChip,
  ComposerSpacer,
  ComposerSurface,
  ComposerTint,
  WebSearchToggle,
  modeSpec,
} from './ComposerSurface'

// Defined with the mode table it drives; re-exported here so the many existing
// importers of `GenerateMode` from this module keep working.
export type { GenerateMode } from './ComposerSurface'

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
  /** Stop the streaming run. Absent when there is nothing to stop. */
  onStop?: () => void
  stopping?: boolean
  connectors: ConnectorsState
  onConnectorsChange: (key: keyof ConnectorsState, value: boolean) => void
  activeGenerateMode: GenerateMode | null
  onSelectGenerateMode: (mode: GenerateMode) => void
  onClearGenerateMode: () => void
  pendingAttachments: PendingChatAttachment[]
  referencedAttachments: ChatAttachmentListItem[]
  attachmentsUploading: boolean
  attachmentErrors: string[]
  onAttachmentFiles: (e: ChangeEvent<HTMLInputElement>) => void
  onRemoveAttachment: (attachmentId: string) => void
  onRemoveReferenced: (attachmentId: string) => void
  onPaste: (e: ClipboardEvent<HTMLTextAreaElement>) => void
  batchId?: string
  chatId?: string
  onOpenFilesPanel?: () => void
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
  onStop,
  stopping = false,
  connectors,
  onConnectorsChange,
  activeGenerateMode,
  onSelectGenerateMode,
  onClearGenerateMode,
  pendingAttachments,
  referencedAttachments,
  attachmentsUploading,
  attachmentErrors,
  onAttachmentFiles,
  onRemoveAttachment,
  onRemoveReferenced,
  onPaste,
  batchId,
  chatId,
  onOpenFilesPanel,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [previewAttachment, setPreviewAttachment] = useState<ChatAttachmentSnapshot | null>(null)
  const attachmentInputRef = useRef<HTMLInputElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return undefined
    function handlePointerDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [menuOpen])

  function selectGenerateMode(mode: GenerateMode) {
    onSelectGenerateMode(mode)
    setMenuOpen(false)
    requestAnimationFrame(() => textareaRef.current?.focus())
  }

  function openFilePicker() {
    setMenuOpen(false)
    attachmentInputRef.current?.click()
  }

  function openPreviousAttachments() {
    setMenuOpen(false)
    onOpenFilesPanel?.()
  }

  const canUsePreviousAttachments = Boolean(batchId && chatId && onOpenFilesPanel)
  const attachDisabled = disabled || sending || attachmentsUploading || pendingAttachments.length >= 5

  const placeholder = modeSpec(activeGenerateMode)?.placeholder ?? 'Message your teaching assistant...'

  const hasBlockingAttachment = pendingAttachments.some(
    (attachment) => attachment.status === 'too_large' || attachment.status === 'failed',
  )

  return (
    <footer
      className={`relative z-10 px-4 pb-5 pt-6 bg-gradient-to-t from-white/90 via-white/65 to-transparent backdrop-blur-sm flex-shrink-0 transition-opacity ${
        dimmed ? 'opacity-40 pointer-events-none' : ''
      }`}
    >
      <div className="max-w-3xl mx-auto">
        {referencedAttachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {referencedAttachments.map((attachment) => (
              <div key={attachment.attachment_id} className="flex max-w-xs items-center gap-2 rounded-xl border border-violet-200 bg-violet-50/80 p-2 shadow-sm">
                {attachment.attachment_kind === 'image' ? <ImageIcon className="h-5 w-5 flex-shrink-0 text-sky-600" /> : <FileText className="h-5 w-5 flex-shrink-0 text-violet-600" />}
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium text-slate-700">{attachment.file_title || attachment.file_name}</p>
                  <p className="text-[11px] text-slate-400">Earlier attachment</p>
                </div>
                <button type="button" onClick={() => onRemoveReferenced(attachment.attachment_id)} className="rounded p-1 text-slate-400 hover:bg-slate-100" aria-label={`Remove ${attachment.file_title || attachment.file_name}`}>
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
        {attachmentErrors.map((error) => <p key={error} className="mb-1 text-xs text-red-600">{error}</p>)}
        {pendingAttachments.some((attachment) => attachment.status === 'processing') && (
          <p className="mb-1 text-xs text-slate-500">Some attachments are still processing — you can send now, and the assistant may note a file isn't ready yet.</p>
        )}
        {hasBlockingAttachment && (
          <p className="mb-1 text-xs text-amber-600">Remove the flagged attachment to send. Large files belong in Course Space, where they’re indexed for retrieval.</p>
        )}
        <ComposerTint active={connectors.web_search}>
          {connectors.web_search && (
            <div className="flex items-center gap-2 px-3.5 py-1.5 text-xs font-medium text-violet-800">
              <Globe className="h-3.5 w-3.5 flex-shrink-0" />
              <span className="min-w-0 flex-1 truncate">
                Web search is on — MILA will look things up for this message.
              </span>
              <button
                type="button"
                onClick={() => onConnectorsChange('web_search', false)}
                className="inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-violet-700 hover:bg-violet-100"
                aria-label="Turn off web search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        <ComposerSurface>
          {/* Attachments live inside the composer now, so the box grows to hold
              them instead of them floating above it. */}
          {pendingAttachments.length > 0 && (
            <div className="flex flex-wrap gap-2 px-1 pb-1 pt-2">
              {pendingAttachments.map((attachment) => (
                <AttachmentCard
                  key={attachment.attachment_id}
                  batchId={batchId}
                  chatId={chatId}
                  attachment={attachment}
                  status={attachmentStatusLabel(attachment)}
                  onOpen={() => setPreviewAttachment(attachment)}
                  onRemove={() => onRemoveAttachment(attachment.attachment_id)}
                />
              ))}
            </div>
          )}
          <input
            ref={attachmentInputRef}
            type="file"
            multiple
            accept=".pdf,.docx,.pptx,.txt,.md,.markdown,.csv,.png,.jpg,.jpeg,.webp,.heic,.heif"
            onChange={onAttachmentFiles}
            disabled={disabled || sending || attachmentsUploading}
            className="sr-only"
          />
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
            className={COMPOSER_TEXTAREA_CLASS}
          />

          {/* Control row — mirrors the reference: add, toggles, then send. */}
          <ComposerControls>
          <ComposerAddMenu
            menuRef={menuRef}
            open={menuOpen}
            onOpenChange={setMenuOpen}
            onAttach={openFilePicker}
            attachDisabled={attachDisabled}
            uploading={attachmentsUploading}
            disabled={disabled || sending}
            onOpenPreviousAttachments={canUsePreviousAttachments ? openPreviousAttachments : undefined}
            onSelectMode={selectGenerateMode}
          />
            {/* A real left-right switch — the design system's Switch, whose
                .prompt.md names "Web Search" as its example connector toggle.
                The outer <label htmlFor> lets the icon and text toggle it too;
                an input may have more than one label. */}
            <WebSearchToggle
              id="web-search-toggle"
              checked={connectors.web_search}
              disabled={disabled || sending}
              onChange={(value) => onConnectorsChange('web_search', value)}
            />

            {activeGenerateMode && (
              <ComposerModeChip mode={activeGenerateMode} onClear={onClearGenerateMode} />
            )}

            <ComposerSpacer />

            {/* While a run streams, the same slot becomes Stop — one control,
                so the primary action is always where the user last looked. */}
            {sending && onStop ? (
              <IconButton
                variant="solid"
                size="lg"
                label="Stop generating"
                onClick={onStop}
                disabled={stopping}
              >
                {stopping ? <Spinner size={16} tone="inverse" /> : <Square className="h-3.5 w-3.5 fill-current" />}
              </IconButton>
            ) : (
              <IconButton
                variant="solid"
                size="lg"
                label="Send message"
                onClick={onSend}
                disabled={
                  (!input.trim() &&
                    pendingAttachments.length === 0 &&
                    referencedAttachments.length === 0) ||
                  disabled ||
                  sending ||
                  attachmentsUploading ||
                  hasBlockingAttachment
                }
              >
                <Send className="h-4 w-4" />
              </IconButton>
            )}
          </ComposerControls>
        </ComposerSurface>
        </ComposerTint>
        <ComposerHint>Enter to send · Shift+Enter for new line</ComposerHint>
        {previewAttachment && (
          <AttachmentViewer
            batchId={batchId}
            chatId={chatId}
            attachment={previewAttachment}
            onClose={() => setPreviewAttachment(null)}
          />
        )}
      </div>
    </footer>
  )
}

type MessagesPanelProps = {
  batchId?: string
  messages: ChatMessage[]
  messagesLoading: boolean
  showWelcome: boolean
  sending: boolean
  runStates: Record<string, RunUiState>
  messagesEndRef: RefObject<HTMLDivElement | null>
  /** Height of the floating composer, reserved as padding under the transcript. */
  bottomInset?: number
  welcomeContent: React.ReactNode
  onApproveOutline: (message: ChatMessage) => void
  onRetryMessage?: (message: ChatMessage) => void
  retryingMessageId?: string | null
}

export function ChatMessagesPanel({
  batchId,
  messages,
  messagesLoading,
  showWelcome,
  sending,
  runStates,
  messagesEndRef,
  bottomInset,
  welcomeContent,
  onApproveOutline,
  onRetryMessage,
  retryingMessageId,
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
    <main className="flex-1 overflow-y-auto" style={{ paddingBottom: bottomInset }}>
      <div className="max-w-3xl mx-auto px-4 py-8 min-h-full flex flex-col">
        {messagesLoading ? (
          <div className="flex-1 flex items-center justify-center">
            <Spinner size={24} />
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
                onRetry={onRetryMessage}
                retrying={retryingMessageId === msg.message_id}
              />
            ))}
            {sending && !safeMessages.some((msg) => msg.pending) && <ThinkingIndicator />}
          </div>
        )}
        {/* scroll-margin keeps `scrollIntoView({ block: 'end' })` from parking
            the marker under the floating composer: it stops the same distance
            up that the padding reserves, so auto-scroll and the re-pin below
            settle on the identical resting position. */}
        <div ref={messagesEndRef} style={{ scrollMarginBottom: bottomInset }} />
      </div>
    </main>
  )
}

function isGeneratedOutlineApprovalText(content: string) {
  return content.trim().toLowerCase().startsWith('approve this outline and generate the full ')
}
