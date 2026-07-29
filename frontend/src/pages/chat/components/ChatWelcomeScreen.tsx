import type { Chat } from '../../../entity/Chat'
import { Sparkles } from 'lucide-react'
import { SUGGESTIONS } from '../constants'

type Props = {
  activeChat: Chat
  onSuggestionClick: (text: string) => void
}

export function ChatWelcomeScreen({ activeChat, onSuggestionClick }: Props) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center py-12">
      <div className="w-12 h-12 rounded-2xl bg-white/50 border border-white/60 shadow-lg flex items-center justify-center mb-5">
        <Sparkles className="w-6 h-6 text-emerald-600" />
      </div>
      <h2 className="text-xl font-semibold text-slate-800 mb-1">How can I help you teach today?</h2>
      <p className="text-slate-500 text-sm mb-8">
        Chatting in <span className="font-medium text-slate-700">{activeChat.title}</span>
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-lg">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onSuggestionClick(s)}
            className="px-4 py-3 text-sm text-left text-slate-600 rounded-2xl bg-white/40 border border-white/50 hover:bg-white/60 hover:text-slate-800 shadow-sm transition-all"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  )
}
