import { Sparkles } from 'lucide-react'
import type { ChatPageState } from '../hooks/useChatPage'
import { BatchSelectorBar } from './BatchSelectorBar'
import { ChatInput, ChatMessagesPanel } from './ChatConversation'
import { ChatWelcomeScreen } from './ChatWelcomeScreen'

type Props = Pick<
  ChatPageState,
  | 'batches'
  | 'batchesLoading'
  | 'selectedBatch'
  | 'setSelectedBatch'
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
  | 'activeGenerateMode'
  | 'setActiveGenerateMode'
  | 'handleInputKeyDown'
  | 'handleTextareaInput'
  | 'showWelcome'
  | 'connectors'
  | 'setConnectors'
  | 'routeHydration'
>

export function ChatLayout(props: Props) {
  const {
    batches,
    batchesLoading,
    selectedBatch,
    setSelectedBatch,
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
    activeGenerateMode,
    setActiveGenerateMode,
    handleInputKeyDown,
    handleTextareaInput,
    showWelcome,
    connectors,
    setConnectors,
    routeHydration,
  } = props

  const isRouteInvalid = routeHydration === 'invalid'

  return (
    <div className="absolute inset-0 flex flex-col overflow-hidden">
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        <div className="absolute -top-24 left-1/4 w-72 h-72 rounded-full bg-emerald-200/30 blur-3xl" />
        <div className="absolute bottom-20 right-1/4 w-96 h-96 rounded-full bg-sky-200/25 blur-3xl" />
      </div>

      <div className="relative z-0 flex flex-col flex-1 min-h-0">
        {!selectedBatch ? (
          <main className="flex-1 overflow-y-auto">
            <div className="max-w-3xl mx-auto px-4 py-8 min-h-full flex flex-col items-center justify-center text-center">
              <div className="w-14 h-14 rounded-2xl bg-white/50 border border-white/60 shadow-lg flex items-center justify-center mb-6">
                <Sparkles className="w-7 h-7 text-emerald-600" />
              </div>
              <h2 className="text-2xl font-semibold text-slate-800 mb-2">AI Teaching Assistant</h2>
              <p className="text-slate-500 text-sm max-w-sm">
                Select a batch below to start chatting about lesson plans, assessments, and more.
              </p>
            </div>
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
            batchId={selectedBatch.id}
            messages={messages}
            messagesLoading={messagesLoading}
            runStates={runStates}
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
        )}

        <div className="z-20 flex flex-col flex-shrink-0 bg-transparent">
          <BatchSelectorBar
            batches={batches}
            batchesLoading={batchesLoading}
            selectedBatch={selectedBatch}
            onSelectBatch={setSelectedBatch}
          />

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
            onConnectorsChange={(key, value) => setConnectors(prev => ({ ...prev, [key]: value }))}
          />
        </div>
      </div>
    </div>
  )
}
