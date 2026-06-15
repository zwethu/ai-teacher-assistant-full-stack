import type { RefObject } from 'react'
import type { KeyboardEvent } from 'react'
import type { ChatMessage } from '../../../entity/Chat'
import { Loader2, Send } from 'lucide-react'
import { MessageRow, ThinkingIndicator } from './MessageRow'

type Props = {
  input: string
  sending: boolean
  textareaRef: RefObject<HTMLTextAreaElement | null>
  onInputChange: (value: string) => void
  onInputKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => void
  onTextareaInput: () => void
  onSend: () => void
}

export function ChatInput({
  input,
  sending,
  textareaRef,
  onInputChange,
  onInputKeyDown,
  onTextareaInput,
  onSend,
}: Props) {
  return (
    <footer className="relative z-10 px-4 pb-5 pt-2 bg-gradient-to-t from-white/60 via-white/30 to-transparent backdrop-blur-sm flex-shrink-0">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-end gap-2 p-2 rounded-[28px] bg-white/55 border border-white/60 shadow-[0_8px_32px_rgba(15,23,42,0.08)]">
          <textarea
            ref={textareaRef}
            rows={1}
            value={input}
            onChange={(e) => onInputChange(e.target.value)}
            onInput={onTextareaInput}
            onKeyDown={onInputKeyDown}
            placeholder="Message your teaching assistant…"
            disabled={sending}
            className="flex-1 resize-none bg-transparent px-4 py-3 text-[15px] text-slate-800 placeholder:text-slate-400 focus:outline-none disabled:cursor-not-allowed max-h-40 overflow-y-auto leading-6"
          />
          <button
            type="button"
            onClick={onSend}
            disabled={!input.trim() || sending}
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

type MessagesPanelProps = {
  messages: ChatMessage[]
  messagesLoading: boolean
  showWelcome: boolean
  sending: boolean
  messagesEndRef: RefObject<HTMLDivElement | null>
  welcomeContent: React.ReactNode
}

export function ChatMessagesPanel({
  messages,
  messagesLoading,
  showWelcome,
  sending,
  messagesEndRef,
  welcomeContent,
}: MessagesPanelProps) {
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
          <div className="space-y-6 pb-4">
            {messages.map((msg) => (
              <MessageRow key={msg.message_id} msg={msg} />
            ))}
            {sending && <ThinkingIndicator />}
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>
    </main>
  )
}
