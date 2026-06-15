import { useChatPage } from './hooks/useChatPage'
import { ChatLayout } from './components/ChatLayout'

export default function Chat() {
  const state = useChatPage()

  return (
    <ChatLayout
      batches={state.batches}
      batchesLoading={state.batchesLoading}
      selectedBatch={state.selectedBatch}
      setSelectedBatch={state.setSelectedBatch}
      activeChat={state.activeChat}
      messages={state.messages}
      messagesLoading={state.messagesLoading}
      input={state.input}
      setInput={state.setInput}
      sending={state.sending}
      inputDisabled={state.inputDisabled}
      messagesEndRef={state.messagesEndRef}
      textareaRef={state.textareaRef}
      handleSend={state.handleSend}
      handleInputKeyDown={state.handleInputKeyDown}
      handleTextareaInput={state.handleTextareaInput}
      showWelcome={state.showWelcome}
    />
  )
}
