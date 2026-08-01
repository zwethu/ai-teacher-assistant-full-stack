import { useMemo, useRef, useState, type RefObject } from 'react'
import type { Chat } from '../../../entity/Chat'
import { Check, MessageSquarePlus, Pencil, Trash2, X } from 'lucide-react'
import { Spinner, Button } from '../../../design-system'
import { useLoadEarlierOnScrollBottom } from '../../../hooks/useEarlierPaging'
import { groupByAge } from '../utils/groupChatsByAge'

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
  /** Paging the list. Older chats load as the lecturer reaches the bottom. */
  hasMoreChats?: boolean
  loadingMoreChats?: boolean
  onLoadMoreChats?: () => void
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
  hasMoreChats = false,
  loadingMoreChats = false,
  onLoadMoreChats,
}: Props) {
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  useLoadEarlierOnScrollBottom(listRef, {
    enabled: hasMoreChats && Boolean(onLoadMoreChats),
    busy: loadingMoreChats,
    onLoad: onLoadMoreChats,
  })
  // Recomputed only when the list itself changes: `Date.now()` inside means a
  // chat can cross from Today into This week, but only on a render that had a
  // reason to happen anyway. Nothing here is worth a timer.
  const groups = useMemo(() => groupByAge(chats, (chat) => chat.created_at), [chats])

  return (
    <aside
      className={`flex-shrink-0 transition-all duration-300 overflow-hidden ${
        sidebarOpen ? 'w-64 border-r border-white/40' : 'w-0'
      } flex flex-col backdrop-blur-xl bg-white/20`}
    >
      <div className="p-3 border-b border-white/40 flex-shrink-0">
        <Button type="button" onClick={onNewChat} block>
          <MessageSquarePlus className="w-4 h-4" />
          New Chat
        </Button>
      </div>

      <div ref={listRef} className="flex-1 overflow-y-auto py-1">
        {chatsLoading ? (
          <div className="flex justify-center py-8">
            <Spinner size={20} />
          </div>
        ) : chats.length === 0 ? (
          <p className="text-xs text-slate-400 text-center py-8 px-3">No chats yet. Start a new one.</p>
        ) : (
          groups.map((group) => (
          <section key={group.label}>
            {/* Sticky so the band you are in stays named while you scroll
                through it — otherwise the heading is gone by the second chat
                and the labels answer a question nobody can still see. */}
            <h2 className="sticky top-0 z-10 bg-white/40 px-5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500 backdrop-blur-sm">
              {group.label}
            </h2>
            {group.items.map((chat) => (
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
                  className="flex-1 min-w-0 bg-transparent text-sm outline-none border-b border-violet-400"
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <span className="flex-1 min-w-0 text-sm truncate">{chat.title}</span>
              )}

              <div
                className={`flex items-center gap-0.5 flex-shrink-0 transition-opacity ${
                  confirmDeleteId === chat.chat_id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                }`}
                onBlur={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                    setConfirmDeleteId(null)
                  }
                }}
              >
                {confirmDeleteId === chat.chat_id ? (
                  <>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        setConfirmDeleteId(null)
                        void onDeleteChat(chat)
                      }}
                      className="p-1 rounded hover:bg-red-50 text-red-500 hover:text-red-600"
                      aria-label="Confirm delete chat"
                    >
                      <Check className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        setConfirmDeleteId(null)
                      }}
                      className="p-1 rounded hover:bg-white/50 text-slate-400 hover:text-slate-600"
                      aria-label="Cancel delete chat"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        onStartRename(chat)
                      }}
                      className="p-1 rounded hover:bg-white/50 text-slate-400 hover:text-slate-600"
                      aria-label="Rename chat"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        setConfirmDeleteId(chat.chat_id)
                      }}
                      className="p-1 rounded hover:bg-red-50 text-slate-400 hover:text-red-500"
                      aria-label="Delete"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </>
                )}
              </div>
            </div>
            ))}
          </section>
          ))
        )}
        {/* Sits under the last group rather than replacing it, so the list the
            lecturer is reading never shortens while the next page is fetched. */}
        {hasMoreChats && !chatsLoading && (
          <div className="flex h-9 items-center justify-center">
            {loadingMoreChats && <Spinner size={14} tone="muted" />}
          </div>
        )}
      </div>
    </aside>
  )
}
