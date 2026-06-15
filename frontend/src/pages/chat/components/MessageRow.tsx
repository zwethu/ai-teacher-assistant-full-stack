import { Bot, User } from 'lucide-react'
import type { ChatMessage } from '../../../entity/Chat'

export function MessageRow({ msg }: { msg: ChatMessage }) {
  const isUser = msg.role === 'user'
  return (
    <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : ''}`}>
      <div
        className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
          isUser
            ? 'bg-emerald-500/90 text-white shadow-md shadow-emerald-500/20'
            : 'bg-white/70 border border-white/60 text-slate-600 shadow-sm'
        }`}
      >
        {isUser ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
      </div>
      <div className={`flex-1 min-w-0 pt-1 ${isUser ? 'flex justify-end' : ''}`}>
        <div
          className={`inline-block max-w-full text-[15px] leading-7 whitespace-pre-wrap ${
            isUser
              ? 'px-4 py-2.5 rounded-3xl rounded-br-md bg-emerald-500/15 border border-emerald-300/30 text-slate-800'
              : 'text-slate-700'
          }`}
        >
          {msg.content}
        </div>
      </div>
    </div>
  )
}

export function ThinkingIndicator() {
  return (
    <div className="flex gap-3">
      <div className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center bg-white/70 border border-white/60 text-slate-600 shadow-sm">
        <Bot className="w-4 h-4" />
      </div>
      <div className="pt-2">
        <div className="inline-flex items-center gap-1 px-4 py-3 rounded-2xl bg-white/50 border border-white/50">
          {[0, 150, 300].map((delay) => (
            <span
              key={delay}
              className="w-2 h-2 rounded-full bg-slate-400 animate-bounce"
              style={{ animationDelay: `${delay}ms` }}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
