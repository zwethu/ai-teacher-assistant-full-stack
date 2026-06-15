import { useNavigate } from 'react-router-dom'
import { BatchSelectionView } from './components/BatchSelectionView'
import { ChatLayout } from './components/ChatLayout'
import { NoBatchesView } from './components/NoBatchesView'
import { useChatPage } from './hooks/useChatPage'

export default function Chat() {
  const navigate = useNavigate()
  const state = useChatPage()

  if (!state.batchesLoading && state.batches.length === 0) {
    return <NoBatchesView onGoToBatches={() => navigate('/batches')} />
  }

  if (!state.selectedBatch) {
    return (
      <BatchSelectionView
        batches={state.batches}
        batchesLoading={state.batchesLoading}
        onSelectBatch={state.setSelectedBatch}
      />
    )
  }

  return (
    <ChatLayout
      selectedBatch={state.selectedBatch}
      setSelectedBatch={state.setSelectedBatch}
      sidebarOpen={state.sidebarOpen}
      setSidebarOpen={state.setSidebarOpen}
      chats={state.chats}
      chatsLoading={state.chatsLoading}
      activeChat={state.activeChat}
      setActiveChat={state.setActiveChat}
      renamingId={state.renamingId}
      setRenamingId={state.setRenamingId}
      renameValue={state.renameValue}
      setRenameValue={state.setRenameValue}
      messages={state.messages}
      messagesLoading={state.messagesLoading}
      input={state.input}
      setInput={state.setInput}
      sending={state.sending}
      messagesEndRef={state.messagesEndRef}
      textareaRef={state.textareaRef}
      renameInputRef={state.renameInputRef}
      handleNewChat={state.handleNewChat}
      handleSend={state.handleSend}
      handleInputKeyDown={state.handleInputKeyDown}
      handleTextareaInput={state.handleTextareaInput}
      startRename={state.startRename}
      commitRename={state.commitRename}
      handleDeleteChat={state.handleDeleteChat}
      showWelcome={state.showWelcome}
    />
  )
}
