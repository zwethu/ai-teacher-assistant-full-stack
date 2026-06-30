import { useChatPage } from './hooks/useChatPage'
import { ChatLayout } from './components/ChatLayout'
import { ChatErrorBoundary } from './components/ChatErrorBoundary'

export default function Chat() {
  const state = useChatPage()

  return (
    <ChatErrorBoundary>
      <ChatLayout
        batches={state.batches}
        batchesLoading={state.batchesLoading}
        selectedBatch={state.selectedBatch}
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
        activeGenerateMode={state.activeGenerateMode}
        setActiveGenerateMode={state.setActiveGenerateMode}
        handleInputKeyDown={state.handleInputKeyDown}
        handleTextareaInput={state.handleTextareaInput}
        showWelcome={state.showWelcome}
        connectors={state.connectors}
        setConnectors={state.setConnectors}
        routeHydration={state.routeHydration}
        pendingAttachments={state.pendingAttachments}
        attachmentsUploading={state.attachmentsUploading}
        attachmentErrors={state.attachmentErrors}
        handleAttachmentFiles={state.handleAttachmentFiles}
        removePendingAttachment={state.removePendingAttachment}
        handleComposerPaste={state.handleComposerPaste}
      />
    </ChatErrorBoundary>
  )
}
