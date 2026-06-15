import type { RefObject } from 'react'
import type { Chat } from '../../../entity/Chat'
import { Loader2, MessageSquarePlus, MoreHorizontal, Trash2 } from 'lucide-react'

type Props = {
  sidebarOpen: boolean
  chats: Chat[]
  chatsLoading: boolean
  activeChat: Chat | null
  renamingId: string | null
  renameValue: string
  renameInputRef: RefObject<HTMLInputElement | null>
  onNewChat: () => void
  onSelectChat: (chat: Chat) => void
  onRenameValueChange: (value: string) => void
  onCommitRename: () => void
  onCancelRename: () => void
  onStartRename: (chat: Chat) => void
  onDeleteChat: (chat: Chat) => void
}

export function ChatSidebar({
  sidebarOpen,
  chats,
  chatsLoading,
  activeChat,
  renamingId,
  renameValue,
  renameInputRef,
  onNewChat,
  onSelectChat,
  onRenameValueChange,
  onCommitRename,
  onCancelRename,
  onStartRename,
  onDeleteChat,
}: Props) {
  return (
    <aside
      className={`flex-shrink-0 transition-all duration-300 overflow-hidden ${
        sidebarOpen ? 'w-64 border-r border-white/40' : 'w-0'
      } flex flex-col backdrop-blur-xl bg-white/20`}
    >
      <div className="p-3 border-b border-white/40 flex-shrink-0">
        <button
          type="button"
          onClick={onNewChat}
          className="w-full flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 transition-colors shadow-sm"
        >
          <MessageSquarePlus className="w-4 h-4" />
          New Chat
        </button>
      </div>

      <div className="flex-1 overflow-y-auto py-1">
        {chatsLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="w-5 h-5 text-emerald-600 animate-spin" />
          </div>
        ) : chats.length === 0 ? (
          <p className="text-xs text-slate-400 text-center py-8 px-3">No chats yet. Start a new one.</p>
        ) : (
          chats.map((chat) => (
            <div
              key={chat.chat_id}
              className={`group relative flex items-center gap-2 mx-2 my-0.5 rounded-lg px-3 py-2 cursor-pointer transition-colors ${
                activeChat?.chat_id === chat.chat_id
                  ? 'bg-white/50 text-slate-900'
                  : 'text-slate-600 hover:bg-white/30 hover:text-slate-800'
              }`}
              onClick={() => {
                if (renamingId === chat.chat_id) return
                onSelectChat(chat)
              }}
            >
              {renamingId === chat.chat_id ? (
                <input
                  ref={renameInputRef}
                  value={renameValue}
                  onChange={(e) => onRenameValueChange(e.target.value)}
                  onBlur={() => void onCommitRename()}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void onCommitRename()
                    if (e.key === 'Escape') onCancelRename()
                  }}
                  className="flex-1 min-w-0 bg-transparent text-sm outline-none border-b border-emerald-400"
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <span className="flex-1 min-w-0 text-sm truncate">{chat.title}</span>
              )}

              <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 flex-shrink-0 transition-opacity">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onStartRename(chat)
                  }}
                  className="p-1 rounded hover:bg-white/50 text-slate-400 hover:text-slate-600"
                  aria-label="Rename"
                >
                  <MoreHorizontal className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    void onDeleteChat(chat)
                  }}
                  className="p-1 rounded hover:bg-red-50 text-slate-400 hover:text-red-500"
                  aria-label="Delete"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </aside>
  )
}
