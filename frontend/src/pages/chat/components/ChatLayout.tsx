import type { ChatPageState } from '../hooks/useChatPage'
import { ChatHeader } from './ChatHeader'
import { ChatSidebar } from './ChatSidebar'
import { ChatInput, ChatMessagesPanel } from './ChatConversation'
import { ChatWelcomeScreen } from './ChatWelcomeScreen'
import { EmptyChatPrompt } from './EmptyChatPrompt'

type Props = Pick<
  ChatPageState,
  | 'selectedBatch'
  | 'setSelectedBatch'
  | 'sidebarOpen'
  | 'setSidebarOpen'
  | 'chats'
  | 'chatsLoading'
  | 'activeChat'
  | 'setActiveChat'
  | 'renamingId'
  | 'setRenamingId'
  | 'renameValue'
  | 'setRenameValue'
  | 'messages'
  | 'messagesLoading'
  | 'input'
  | 'setInput'
  | 'sending'
  | 'messagesEndRef'
  | 'textareaRef'
  | 'renameInputRef'
  | 'handleNewChat'
  | 'handleSend'
  | 'handleInputKeyDown'
  | 'handleTextareaInput'
  | 'startRename'
  | 'commitRename'
  | 'handleDeleteChat'
  | 'showWelcome'
>

export function ChatLayout(props: Props) {
  const {
    selectedBatch,
    setSelectedBatch,
    sidebarOpen,
    setSidebarOpen,
    chats,
    chatsLoading,
    activeChat,
    setActiveChat,
    renamingId,
    setRenamingId,
    renameValue,
    setRenameValue,
    messages,
    messagesLoading,
    input,
    setInput,
    sending,
    messagesEndRef,
    textareaRef,
    renameInputRef,
    handleNewChat,
    handleSend,
    handleInputKeyDown,
    handleTextareaInput,
    startRename,
    commitRename,
    handleDeleteChat,
    showWelcome,
  } = props

  if (!selectedBatch) return null

  return (
    <div className="relative flex flex-col flex-1 min-h-0 -mx-4 md:-mx-8 -my-4 md:-my-8 overflow-hidden">
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        <div className="absolute -top-24 left-1/4 w-72 h-72 rounded-full bg-emerald-200/30 blur-3xl" />
        <div className="absolute bottom-20 right-1/4 w-96 h-96 rounded-full bg-sky-200/25 blur-3xl" />
      </div>

      <ChatHeader
        selectedBatch={selectedBatch}
        sidebarOpen={sidebarOpen}
        onBack={() => setSelectedBatch(null)}
        onToggleSidebar={() => setSidebarOpen((v) => !v)}
      />

      <div className="relative z-0 flex flex-1 min-h-0">
        <ChatSidebar
          sidebarOpen={sidebarOpen}
          chats={chats}
          chatsLoading={chatsLoading}
          activeChat={activeChat}
          renamingId={renamingId}
          renameValue={renameValue}
          renameInputRef={renameInputRef}
          onNewChat={() => void handleNewChat()}
          onSelectChat={setActiveChat}
          onRenameValueChange={setRenameValue}
          onCommitRename={commitRename}
          onCancelRename={() => setRenamingId(null)}
          onStartRename={startRename}
          onDeleteChat={handleDeleteChat}
        />

        <div className="flex flex-col flex-1 min-w-0 min-h-0">
          {!activeChat ? (
            <EmptyChatPrompt
              batchName={selectedBatch.batch_name}
              onNewChat={() => void handleNewChat()}
            />
          ) : (
            <>
              <ChatMessagesPanel
                messages={messages}
                messagesLoading={messagesLoading}
                showWelcome={showWelcome}
                sending={sending}
                messagesEndRef={messagesEndRef}
                welcomeContent={
                  <ChatWelcomeScreen
                    activeChat={activeChat}
                    onSuggestionClick={(text) => void handleSend(text)}
                  />
                }
              />
              <ChatInput
                input={input}
                sending={sending}
                textareaRef={textareaRef}
                onInputChange={setInput}
                onInputKeyDown={handleInputKeyDown}
                onTextareaInput={handleTextareaInput}
                onSend={() => void handleSend()}
              />
            </>
          )}
        </div>
      </div>
    </div>
  )
}
