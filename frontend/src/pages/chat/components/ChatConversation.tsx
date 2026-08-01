import { useEffect, useRef, useState, type RefObject } from 'react'
import type { ChangeEvent, ClipboardEvent, KeyboardEvent } from 'react'
import type { ChatMessage } from '../../../entity/Chat'
import { CornerUpLeft, Globe, Send, Square, X } from 'lucide-react'
import { MessageRow, ThinkingIndicator } from './MessageRow'
import { type ConnectorsState } from './ConnectorToggles'
import type { RunUiState } from '../runTypes'
import type { PendingChatAttachment } from '../hooks/useChatPage'
import type { ChatAttachmentListItem } from '../../../entity/Chat'
import type { UpdatePendingEmailResult } from '../../../services/chatService'
import { Spinner, IconButton } from '../../../design-system'
import { useScrollbarGutter } from '../../../hooks/useScrollbarGutter'
import { isAutoIssuedUserMessage } from '../utils/autoIssuedMessage'
import type { PreviewableAttachment } from './AttachmentPreview'
import { AttachmentCard, AttachmentViewer, attachmentStatusLabel } from './AttachmentPreview'
import type { GenerateMode } from './ComposerSurface'
import {
  COMPOSER_TEXTAREA_CLASS,
  ComposerAddMenu,
  ComposerCollapse,
  ComposerControls,
  ComposerHint,
  ComposerModeChip,
  ComposerSpacer,
  ComposerSurface,
  ComposerTint,
  WebSearchToggle,
  modeSpec,
  useComposerPresence,
  useExitDelay,
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
  /** Passage quoted from an earlier response, and how to drop it. */
  quotedReply?: string
  onClearQuotedReply?: () => void
  batchId?: string
  chatId?: string
  onOpenFilesPanel?: () => void
}

/** One attachment tile in the composer strip, whatever it was attached by. */
type ComposerTile = {
  key: string
  attachment: PreviewableAttachment
  status: string
  remove: () => void
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
  quotedReply = '',
  onClearQuotedReply,
  batchId,
  chatId,
  onOpenFilesPanel,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [previewAttachment, setPreviewAttachment] = useState<PreviewableAttachment | null>(null)
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

  // Re-referenced earlier files and newly attached ones are one strip: from
  // the lecturer's side they are the same act, and they animate in and out as
  // one row rather than as two lists that happen to sit next to each other.
  const tiles: ComposerTile[] = [
    ...referencedAttachments.map((attachment) => ({
      key: `ref-${attachment.attachment_id}`,
      attachment,
      status: 'earlier attachment',
      remove: () => onRemoveReferenced(attachment.attachment_id),
    })),
    ...pendingAttachments.map((attachment) => ({
      key: attachment.attachment_id,
      attachment,
      status: attachmentStatusLabel(attachment),
      remove: () => onRemoveAttachment(attachment.attachment_id),
    })),
  ]
  // Departed tiles stay one exit animation longer than the props say, so
  // removing one — or sending, which clears the lot — plays the arrival
  // backwards instead of blinking out.
  const tileEntries = useComposerPresence(tiles, (tile) => tile.key)
  // Keyed on the entries, not the props, so removing the last tile reads as two
  // beats — the tile leaves, then the box closes behind it. Keying on `tiles`
  // collapses the strip while the tile is still fading, which squashes it.
  const hasTiles = tileEntries.length > 0
  const webSearchStripMounted = useExitDelay(connectors.web_search)
  const quoteMounted = useExitDelay(Boolean(quotedReply))
  // The warnings sit above the composer and appear and vanish on exactly the
  // same gestures, so they get the same easing — otherwise attaching a file
  // still jumps the layout, just one line higher up.
  const processingNotice = pendingAttachments.some((attachment) => attachment.status === 'processing')
  const noticesMounted = useExitDelay(processingNotice || hasBlockingAttachment || attachmentErrors.length > 0)

  return (
    /* No wash across the footer. A full-width `from-white/90` gradient plus
       `backdrop-blur-sm` sat behind the composer and flattened it: `.maia-glass`
       is white/55 over blur(24px), so laying it on an already-white, already-
       blurred band left nothing for the glass to refract and it read as a plain
       white slab with a hard edge across the transcript. Transparent here means
       the composer is the only glass, and the conversation blurs through it. */
    <footer
      className={`pointer-events-none relative z-10 px-4 pb-5 pt-6 flex-shrink-0 transition-opacity ${
        dimmed ? 'opacity-40 pointer-events-none' : ''
      }`}
    >
      {/* Everything in this band that the composer does not itself cover — the
          hint line, the bottom padding, the space above — had no surface over
          it, so the conversation scrolled through in full focus. This softens
          it. Blur only, no fill: it spans the band but is only ever visible
          where there is something behind it, so it shows up around the
          composer and nowhere else. */}
      <div aria-hidden="true" className="mila-composer-floor pointer-events-none absolute inset-0 -z-10" />

      <div className={`${dimmed ? 'pointer-events-none' : 'pointer-events-auto'} relative max-w-3xl mx-auto`}>
        <ComposerCollapse
          open={processingNotice || hasBlockingAttachment || attachmentErrors.length > 0}
          region="notices"
          className="pb-1"
        >
          {noticesMounted && (
            <>
              {attachmentErrors.map((error) => <p key={error} className="text-xs text-red-600">{error}</p>)}
              {processingNotice && (
                <p className="text-xs text-slate-500">Some attachments are still processing — you can send now, and the assistant may note a file isn't ready yet.</p>
              )}
              {hasBlockingAttachment && (
                <p className="text-xs text-amber-600">Remove the flagged attachment to send. Large files belong in Course Space, where they’re indexed for retrieval.</p>
              )}
            </>
          )}
        </ComposerCollapse>
        <ComposerTint active={connectors.web_search}>
          {/* The strip's own height is what the tint shell grows around, so it
              eases open with it rather than appearing inside a box that has
              already finished moving. */}
          <ComposerCollapse open={connectors.web_search} region="web-search" className="px-3.5 py-1.5">
            {webSearchStripMounted && (
              /* "can", not "will". The toggle is a permission, not a command:
                 `web_search_gate.py` only *allows* the grounded search to run
                 and the agent still decides whether the question needs it. A
                 promise to search would be wrong on most messages.

                 No close button, and no "Web search is on —" opener either.
                 The switch in the control row already says it is on and is the
                 one way to turn it off; a second dismiss put two identical X
                 glyphs a few inches apart, one turning off a setting and one
                 discarding the whole workflow. */
              <div className="flex items-center gap-2 text-xs font-medium text-violet-800">
                <Globe className="h-3.5 w-3.5 flex-shrink-0" />
                <span className="min-w-0 flex-1 truncate">
                  MILA can search the web when this message needs it.
                </span>
              </div>
            )}
          </ComposerCollapse>
        <ComposerSurface>
          {/* Attachments live inside the composer, so the box grows to hold
              them instead of them floating above it — and the growth is the
              strip's own, eased, rather than the composer jumping a tile's
              worth of height in one frame. The padding sits on the collapse's
              clipper because that is what clips: the tiles' remove buttons
              hang outside their tile, and this is the room they need. */}
          {/* Sits above the tiles and the textarea, inside the box, so the
              composer grows to hold it exactly as it does for an attachment. */}
          <ComposerCollapse open={Boolean(quotedReply)} region="quote" className="px-1.5 pt-2">
            {quoteMounted && (
              <div className="flex items-start gap-2.5 rounded-xl border border-white/80 bg-white/65 px-2.5 py-2 shadow-[0_5px_14px_rgba(63,47,107,0.08)]">
                <span className="mt-0.5 inline-flex h-5 w-5 flex-none items-center justify-center rounded-md bg-violet-100 text-violet-700">
                  <CornerUpLeft className="h-3 w-3" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-violet-700">Replying to selection</p>
                  <p className="mt-0.5 text-[13px] leading-5 text-slate-700 line-clamp-2">{quotedReply}</p>
                </div>
                <button
                  type="button"
                  onClick={onClearQuotedReply}
                  className="mt-0.5 inline-flex h-6 w-6 flex-none items-center justify-center rounded-full text-violet-700 transition-colors hover:bg-violet-100 hover:text-violet-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500"
                  aria-label="Remove quoted text"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
          </ComposerCollapse>
          <ComposerCollapse open={hasTiles} region="attachments" className="px-1.5 pb-1 pt-2">
            <div className="flex flex-wrap gap-2">
              {tileEntries.map(({ key, item, leaving }) => (
                <div key={key} className={leaving ? 'mila-tile-out' : 'mila-tile-in'}>
                  <AttachmentCard
                    batchId={batchId}
                    chatId={chatId}
                    attachment={item.attachment}
                    status={item.status}
                    onOpen={() => setPreviewAttachment(item.attachment)}
                    onRemove={item.remove}
                  />
                </div>
              ))}
            </div>
          </ComposerCollapse>
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
            {/* Mode first, then the modifier. The chip changes the placeholder,
                the pipeline and what Send does; web search only colours how the
                agent answers. Reading order should match how much each commits.

                Unguarded: the chip owns its own presence so it can animate out
                when the mode is cleared or the run consumes it. */}
            <ComposerModeChip mode={activeGenerateMode} onClear={onClearGenerateMode} />

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
  onPendingEmailEdited: (runId: string, result: UpdatePendingEmailResult) => void
  onRetryMessage?: (message: ChatMessage) => void
  /** Quote a selected passage of a response into the composer. */
  onQuoteReply?: (excerpt: string) => void
  retryingMessageId?: string | null
  /** Outline message whose approval run is in flight, if any. */
  approvingOutlineMessageId?: string | null
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
  onPendingEmailEdited,
  onRetryMessage,
  onQuoteReply,
  retryingMessageId,
  approvingOutlineMessageId,
}: MessagesPanelProps) {
  // This is the element the composer band overlays, so its scrollbar is the one
  // the band has to stay clear of.
  const scrollRef = useRef<HTMLElement | null>(null)
  useScrollbarGutter(scrollRef)

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
        (later) => later.role === 'user' && !isAutoIssuedUserMessage(later),
      )
      return hasLaterFollowup ? [message.run_id] : []
    }),
  )

  // The approval request itself is not part of the conversation — see
  // `isAutoIssuedUserMessage`. Filtered here rather than upstream so the two
  // derivations above still see the turn that actually happened.
  const visibleMessages = safeMessages.filter((msg) => !isAutoIssuedUserMessage(msg))

  return (
    <main ref={scrollRef} className="flex-1 overflow-y-auto" style={{ paddingBottom: bottomInset }}>
      <div className="max-w-3xl mx-auto px-4 py-8 min-h-full flex flex-col">
        {messagesLoading ? (
          <div className="flex-1 flex items-center justify-center">
            <Spinner size={24} />
          </div>
        ) : showWelcome ? (
          welcomeContent
        ) : (
          <div className="space-y-8 pb-4">
            {visibleMessages.map((msg) => (
              <MessageRow
                key={msg.message_id}
                msg={msg}
                run={msg.run_id ? runStates[msg.run_id] : undefined}
                batchId={batchId}
                onApproveOutline={onApproveOutline}
                approvalDisabled={sending}
                approvalGenerating={approvingOutlineMessageId === msg.message_id}
                approvalCompleted={Boolean(msg.run_id && completedOutlineRunIds.has(msg.run_id))}
                approvalSuperseded={Boolean(msg.run_id && supersededOutlineRunIds.has(msg.run_id))}
                onPendingEmailEdited={onPendingEmailEdited}
                onRetry={onRetryMessage}
                onQuoteReply={onQuoteReply}
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
