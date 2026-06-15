import { MessageSquarePlus, Sparkles } from 'lucide-react'

type Props = {
  batchName: string
  onNewChat: () => void
}

export function EmptyChatPrompt({ batchName, onNewChat }: Props) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center px-4">
      <div className="w-12 h-12 rounded-2xl bg-white/50 border border-white/60 shadow-lg flex items-center justify-center mb-4">
        <Sparkles className="w-6 h-6 text-emerald-600" />
      </div>
      <h3 className="text-lg font-semibold text-slate-700 mb-1">Start a conversation</h3>
      <p className="text-sm text-slate-500 mb-4 max-w-xs">
        Select a previous chat or start a new one about {batchName}.
      </p>
      <button
        type="button"
        onClick={onNewChat}
        className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm"
      >
        <MessageSquarePlus className="w-4 h-4" />
        New Chat
      </button>
    </div>
  )
}
