import { useEffect, useRef, useState, type RefObject } from 'react'
import {
  Check,
  MoreHorizontal,
  PanelRight,
  Pencil,
  Trash2,
  X,
} from 'lucide-react'
import type { Batch } from '../../../entity/Batch'
import type { Chat } from '../../../entity/Chat'

type Props = {
  selectedBatch: Batch | null
  activeChat: Chat | null
  renamingId: string | null
  renameValue: string
  renameInputRef: RefObject<HTMLInputElement | null>
  onRenameValueChange: (value: string) => void
  onStartRename: (chat: Chat) => void
  onCommitRename: () => void
  onCancelRename: () => void
  onDeleteChat: (chat: Chat) => void
  onOpenPanel: () => void
  panelOpen: boolean
}

export function ChatPageHeader({
  selectedBatch,
  activeChat,
  renamingId,
  renameValue,
  renameInputRef,
  onRenameValueChange,
  onStartRename,
  onCommitRename,
  onCancelRename,
  onDeleteChat,
  onOpenPanel,
  panelOpen,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const isRenaming = !!activeChat && renamingId === activeChat.chat_id

  useEffect(() => {
    if (!menuOpen) return
    function handleMouseDown(event: MouseEvent) {
      if (event.target instanceof Element && menuRef.current?.contains(event.target)) return
      setMenuOpen(false)
      setConfirmDelete(false)
    }
    document.addEventListener('mousedown', handleMouseDown)
    return () => document.removeEventListener('mousedown', handleMouseDown)
  }, [menuOpen])

  useEffect(() => {
    setMenuOpen(false)
    setConfirmDelete(false)
  }, [activeChat?.chat_id])

  const spaceLabel = selectedBatch?.batch_name || 'No space selected'

  return (
    <header className="relative z-30 flex h-14 flex-shrink-0 items-center gap-3 border-b border-white/50 bg-white/35 px-4 backdrop-blur-xl">
      <div className="min-w-0 flex-1">
        {isRenaming ? (
          <input
            ref={renameInputRef}
            value={renameValue}
            onChange={(event) => onRenameValueChange(event.target.value)}
            onBlur={() => void onCommitRename()}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void onCommitRename()
              if (event.key === 'Escape') onCancelRename()
            }}
            className="w-full max-w-md bg-transparent text-sm font-semibold text-slate-800 outline-none border-b border-emerald-400"
            aria-label="Rename chat"
          />
        ) : (
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold text-slate-800">{spaceLabel}</h1>
            {activeChat?.title && (
              <p className="truncate text-xs text-slate-500">{activeChat.title}</p>
            )}
          </div>
        )}
      </div>

      {activeChat && selectedBatch && (
        <div className="flex flex-shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={onOpenPanel}
            className={`inline-flex h-9 w-9 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-white/80 hover:text-slate-800 active:scale-95 ${
              panelOpen ? 'bg-emerald-50 text-emerald-700' : ''
            }`}
            aria-label="Open chat links and files"
            aria-pressed={panelOpen}
          >
            <PanelRight className="h-4 w-4" />
          </button>

          <div className="relative" ref={menuRef} data-chat-header-menu>
            {confirmDelete ? (
              <div className="flex items-center gap-0.5">
                <button
                  type="button"
                  onClick={() => {
                    void onDeleteChat(activeChat)
                    setConfirmDelete(false)
                    setMenuOpen(false)
                  }}
                  className="rounded-full p-2 text-red-500 hover:bg-red-50"
                  aria-label="Confirm delete chat"
                >
                  <Check className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  className="rounded-full p-2 text-slate-400 hover:bg-slate-100"
                  aria-label="Cancel delete chat"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => setMenuOpen((open) => !open)}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-white/80 hover:text-slate-800 active:scale-95"
                  aria-label="Chat actions"
                  aria-expanded={menuOpen}
                >
                  <MoreHorizontal className="h-4 w-4" />
                </button>
                {menuOpen && (
                  <div className="absolute right-0 top-10 z-40 w-36 rounded-lg border border-slate-200 bg-white py-1 shadow-lg transition-opacity">
                    <button
                      type="button"
                      onClick={() => {
                        onStartRename(activeChat)
                        setMenuOpen(false)
                      }}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      Rename
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setConfirmDelete(true)
                        setMenuOpen(false)
                      }}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-red-500 hover:bg-red-50 hover:text-red-600"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Delete
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </header>
  )
}
