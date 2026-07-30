import { useChatPage } from './hooks/useChatPage'
import { ChatLayout } from './components/ChatLayout'
import { ChatErrorBoundary } from './components/ChatErrorBoundary'

export default function Chat() {
  const state = useChatPage()

  return (
    <ChatErrorBoundary>
      <ChatLayout
        selectedBatch={state.selectedBatch}
        batches={state.batches}
        batchesLoading={state.batchesLoading}
        setSelectedBatch={state.setSelectedBatch}
        activeChat={state.activeChat}
        messages={state.messages}
        messagesLoading={state.messagesLoading}
        runStates={state.runStates}
        input={state.input}
        setInput={state.setInput}
        sending={state.sending}
        inputDisabled={state.inputDisabled}
        messagesEndRef={state.messagesEndRef}
        textareaRef={state.textareaRef}
        handleSend={state.handleSend}
        handleApproveOutline={state.handleApproveOutline}
        applyPendingEmailEdit={state.applyPendingEmailEdit}
        activeGenerateMode={state.activeGenerateMode}
        setActiveGenerateMode={state.setActiveGenerateMode}
        handleInputKeyDown={state.handleInputKeyDown}
        handleTextareaInput={state.handleTextareaInput}
        showWelcome={state.showWelcome}
        connectors={state.connectors}
        setConnectors={state.setConnectors}
        routeHydration={state.routeHydration}
        pendingAttachments={state.pendingAttachments}
        referencedAttachments={state.referencedAttachments}
        attachmentsUploading={state.attachmentsUploading}
        attachmentErrors={state.attachmentErrors}
        handleAttachmentFiles={state.handleAttachmentFiles}
        removePendingAttachment={state.removePendingAttachment}
        referencePreviousAttachment={state.referencePreviousAttachment}
        removeReferencedAttachment={state.removeReferencedAttachment}
        handleComposerPaste={state.handleComposerPaste}
        handleAskAboutAttachment={state.handleAskAboutAttachment}
        renamingId={state.renamingId}
        renameValue={state.renameValue}
        setRenameValue={state.setRenameValue}
        renameInputRef={state.renameInputRef}
        startRename={state.startRename}
        commitRename={state.commitRename}
        cancelRename={state.cancelRename}
        handleDeleteChat={state.handleDeleteChat}
      />
    </ChatErrorBoundary>
  )
}
