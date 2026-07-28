import { useCallback, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2, Sparkles } from 'lucide-react'
import type { ChatPageState } from '../hooks/useChatPage'
import { ChatInput, ChatMessagesPanel } from './ChatConversation'
import { ChatPageHeader } from './ChatPageHeader'
import { ChatSidePanel, type ChatSidePanelSection } from './ChatSidePanel'
import { ChatWelcomeScreen } from './ChatWelcomeScreen'
import { NoBatchesView } from './NoBatchesView'

type Props = Pick<
  ChatPageState,
  | 'selectedBatch'
  | 'batches'
  | 'batchesLoading'
  | 'activeChat'
  | 'messages'
  | 'messagesLoading'
  | 'runStates'
  | 'input'
  | 'setInput'
  | 'sending'
  | 'inputDisabled'
  | 'messagesEndRef'
  | 'textareaRef'
  | 'handleSend'
  | 'handleApproveOutline'
  | 'activeGenerateMode'
  | 'setActiveGenerateMode'
  | 'handleInputKeyDown'
  | 'handleTextareaInput'
  | 'showWelcome'
  | 'connectors'
  | 'setConnectors'
  | 'routeHydration'
  | 'pendingAttachments'
  | 'referencedAttachments'
  | 'attachmentsUploading'
  | 'attachmentErrors'
  | 'handleAttachmentFiles'
  | 'removePendingAttachment'
  | 'referencePreviousAttachment'
  | 'removeReferencedAttachment'
  | 'handleComposerPaste'
  | 'handleAskAboutAttachment'
  | 'renamingId'
  | 'renameValue'
  | 'setRenameValue'
  | 'renameInputRef'
  | 'startRename'
  | 'commitRename'
  | 'cancelRename'
  | 'handleDeleteChat'
>

export function ChatLayout(props: Props) {
  const {
    selectedBatch,
    batches,
    batchesLoading,
    activeChat,
    messages,
    messagesLoading,
    runStates,
    input,
    setInput,
    sending,
    inputDisabled,
    messagesEndRef,
    textareaRef,
    handleSend,
    handleApproveOutline,
    activeGenerateMode,
    setActiveGenerateMode,
    handleInputKeyDown,
    handleTextareaInput,
    showWelcome,
    connectors,
    setConnectors,
    routeHydration,
    pendingAttachments,
    referencedAttachments,
    attachmentsUploading,
    attachmentErrors,
    handleAttachmentFiles,
    removePendingAttachment,
    referencePreviousAttachment,
    removeReferencedAttachment,
    handleComposerPaste,
    handleAskAboutAttachment,
    renamingId,
    renameValue,
    setRenameValue,
    renameInputRef,
    startRename,
    commitRename,
    cancelRename,
    handleDeleteChat,
  } = props

  const navigate = useNavigate()
  const [sidePanelOpen, setSidePanelOpen] = useState(false)
  const [sidePanelSection, setSidePanelSection] = useState<ChatSidePanelSection | null>(null)
  const isRouteInvalid = routeHydration === 'invalid'

  const openSidePanel = useCallback((section: ChatSidePanelSection | null = null) => {
    setSidePanelSection(section)
    setSidePanelOpen(true)
  }, [])

  const closeSidePanel = useCallback(() => {
    setSidePanelOpen(false)
  }, [])

  const handleReferenceFromPanel = useCallback(
    (item: Parameters<typeof referencePreviousAttachment>[0]) => {
      referencePreviousAttachment(item)
      requestAnimationFrame(() => textareaRef.current?.focus())
    },
    [referencePreviousAttachment, textareaRef],
  )

  return (
    <div className="absolute inset-0 flex flex-col overflow-hidden">
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        <div className="absolute -top-24 left-1/4 w-72 h-72 rounded-full bg-emerald-200/30 blur-3xl" />
        <div className="absolute bottom-20 right-1/4 w-96 h-96 rounded-full bg-sky-200/25 blur-3xl" />
      </div>

      <div className="relative z-0 flex flex-col flex-1 min-h-0">
        <ChatPageHeader
          selectedBatch={selectedBatch}
          activeChat={activeChat}
          renamingId={renamingId}
          renameValue={renameValue}
          renameInputRef={renameInputRef}
          onRenameValueChange={setRenameValue}
          onStartRename={startRename}
          onCommitRename={() => void commitRename()}
          onCancelRename={cancelRename}
          onDeleteChat={(chat) => void handleDeleteChat(chat)}
          onOpenPanel={() => openSidePanel(null)}
          panelOpen={sidePanelOpen}
        />

        {!selectedBatch ? (
          <main className="flex-1 overflow-y-auto">
            {routeHydration === 'hydrating' ? (
              // A canonical /batches/:id/chats/:id URL is still loading its space —
              // show a spinner, not the picker, to avoid a flash of batch selection.
              <div className="max-w-3xl mx-auto px-4 py-8 min-h-full flex items-center justify-center">
                <Loader2 className="w-7 h-7 text-emerald-600 animate-spin" />
              </div>
            ) : isRouteInvalid ? (
              <div className="max-w-3xl mx-auto px-4 py-8 min-h-full flex flex-col items-center justify-center text-center">
                <h3 className="text-lg font-semibold text-slate-700 mb-1">Chat not found</h3>
                <p className="text-sm text-slate-500 mb-4 max-w-xs">
                  This conversation may have been deleted or you may not have access to it.
                </p>
              </div>
            ) : !batchesLoading && batches.length === 0 ? (
              <NoBatchesView onGoToBatches={() => navigate('/batches')} />
            ) : (
              <div className="max-w-3xl mx-auto px-4 py-8 min-h-full flex flex-col items-center justify-center text-center">
                <div className="w-14 h-14 rounded-2xl bg-white/50 border border-white/60 shadow-lg flex items-center justify-center mb-6">
                  <Sparkles className="w-7 h-7 text-emerald-600" />
                </div>
                <h2 className="text-2xl font-semibold text-slate-800 mb-2">AI Teaching Assistant</h2>
                <p className="text-slate-500 text-sm max-w-sm">
                  Pick a batch from the <span className="font-medium text-slate-700">Select a batch</span> button
                  below to start chatting about lesson plans, assessments, and more.
                </p>
              </div>
            )}
          </main>
        ) : isRouteInvalid ? (
          <main className="flex-1 overflow-y-auto">
            <div className="max-w-3xl mx-auto px-4 py-8 min-h-full flex flex-col items-center justify-center text-center">
              <h3 className="text-lg font-semibold text-slate-700 mb-1">Chat not found</h3>
              <p className="text-sm text-slate-500 mb-4 max-w-xs">
                This conversation may have been deleted or you may not have access to it.
              </p>
            </div>
          </main>
        ) : !activeChat ? (
          <main className="flex-1 overflow-y-auto">
            <div className="max-w-3xl mx-auto px-4 py-8 min-h-full flex flex-col items-center justify-center text-center">
              <div className="w-12 h-12 rounded-2xl bg-white/50 border border-white/60 shadow-lg flex items-center justify-center mb-4">
                <Sparkles className="w-6 h-6 text-emerald-600" />
              </div>
              <h3 className="text-lg font-semibold text-slate-700 mb-1">Start a conversation</h3>
              <p className="text-sm text-slate-500 mb-4 max-w-xs">
                Type a message below to begin a new chat in {selectedBatch.batch_name}.
              </p>
            </div>
          </main>
        ) : (
          <ChatMessagesPanel
            batchId={selectedBatch?.id}
            courseName={selectedBatch.course_name}
            messages={messages}
            messagesLoading={messagesLoading}
            runStates={runStates}
            showWelcome={showWelcome}
            sending={sending}
            onApproveOutline={handleApproveOutline}
            onAskAboutAttachment={handleAskAboutAttachment}
            messagesEndRef={messagesEndRef}
            welcomeContent={
              <ChatWelcomeScreen
                activeChat={activeChat}
                onSuggestionClick={(text) => void handleSend(text)}
              />
            }
          />
        )}

        <div className="z-20 flex flex-col flex-shrink-0 bg-transparent">
          <ChatInput
            input={input}
            sending={sending}
            disabled={inputDisabled}
            dimmed={!selectedBatch}
            textareaRef={textareaRef}
            onInputChange={setInput}
            onInputKeyDown={handleInputKeyDown}
            onTextareaInput={handleTextareaInput}
            onSend={() => void handleSend()}
            activeGenerateMode={activeGenerateMode}
            onSelectGenerateMode={setActiveGenerateMode}
            onClearGenerateMode={() => setActiveGenerateMode(null)}
            connectors={connectors}
            onConnectorsChange={(key, value) => setConnectors((prev) => ({ ...prev, [key]: value }))}
            pendingAttachments={pendingAttachments}
            referencedAttachments={referencedAttachments}
            attachmentsUploading={attachmentsUploading}
            attachmentErrors={attachmentErrors}
            onAttachmentFiles={handleAttachmentFiles}
            onRemoveAttachment={removePendingAttachment}
            onRemoveReferenced={removeReferencedAttachment}
            onPaste={handleComposerPaste}
            batchId={selectedBatch?.id}
            chatId={activeChat?.chat_id}
            onOpenFilesPanel={() => openSidePanel('files')}
          />
        </div>
      </div>

      {selectedBatch && activeChat && (
        <ChatSidePanel
          open={sidePanelOpen}
          onClose={closeSidePanel}
          batchId={selectedBatch.id}
          chatId={activeChat.chat_id}
          messages={messages}
          initialSection={sidePanelSection}
          onReferenceAttachment={handleReferenceFromPanel}
        />
      )}
    </div>
  )
}
