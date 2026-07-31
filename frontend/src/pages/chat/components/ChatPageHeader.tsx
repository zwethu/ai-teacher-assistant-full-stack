import { useEffect, useRef, useState, type RefObject } from 'react'
import {
  Check,
  ChevronDown,
  MoreHorizontal,
  PanelRight,
  Pencil,
  Trash2,
  X,
} from 'lucide-react'
import type { Batch } from '../../../entity/Batch'
import { BatchMenuList } from './BatchMenuList'
import type { Chat } from '../../../entity/Chat'
import { EXPORT_FORMAT_LABELS, exportChat, type ChatExportFormat } from '../../../services/chatService'
import { Spinner } from '../../../design-system'
import { EXPORT_FORMATS, EXPORT_FORMAT_ICONS } from './exportFormatIcons'

/** Relative for anything recent, absolute once it stops being useful. */
function formatLastUpdated(value?: string | null): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const minutes = Math.round((Date.now() - date.getTime()) / 60000)
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days <= 7) return `${days}d ago`
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

type Props = {
  selectedBatch: Batch | null
  batches: Batch[]
  onSelectBatch: (batch: Batch) => void
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
  batches,
  onSelectBatch,
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
  const [spaceMenuOpen, setSpaceMenuOpen] = useState(false)
  const [exporting, setExporting] = useState<ChatExportFormat | null>(null)
  const [exportError, setExportError] = useState('')

  const lastUpdated = formatLastUpdated(activeChat?.updated_at || activeChat?.created_at)

  async function handleExport(format: ChatExportFormat) {
    if (!selectedBatch || !activeChat) return
    setExporting(format)
    setExportError('')
    try {
      await exportChat(selectedBatch.id, activeChat.chat_id, format)
      setMenuOpen(false)
    } catch {
      setExportError(`Could not export as ${EXPORT_FORMAT_LABELS[format]}.`)
    } finally {
      setExporting(null)
    }
  }
  const [confirmDelete, setConfirmDelete] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const spaceMenuRef = useRef<HTMLDivElement>(null)
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

  useEffect(() => {
    if (!spaceMenuOpen) return
    function handleMouseDown(event: MouseEvent) {
      if (event.target instanceof Element && spaceMenuRef.current?.contains(event.target)) return
      setSpaceMenuOpen(false)
    }
    document.addEventListener('mousedown', handleMouseDown)
    return () => document.removeEventListener('mousedown', handleMouseDown)
  }, [spaceMenuOpen])

  const spaceLabel = selectedBatch?.batch_name || 'No space selected'
  // The composer no longer carries a space chip — it duplicated this title.
  // Switching lives here instead, and only when there is somewhere to switch to.
  const canSwitchSpace = !!selectedBatch && batches.length > 1

  // .maia-glass-header is exactly this surface in the design system:
  // white/35 + blur(24px) saturate(1.5) + a translucent white hairline.
  return (
    <header className="maia-glass-header relative z-30 flex h-14 flex-shrink-0 items-center gap-3 px-4">
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
            className="w-full max-w-md bg-transparent text-sm font-semibold text-slate-800 outline-none border-b border-violet-400"
            aria-label="Rename chat"
          />
        ) : (
          <div className="relative min-w-0" ref={spaceMenuRef}>
            {canSwitchSpace ? (
              <button
                type="button"
                onClick={() => setSpaceMenuOpen((open) => !open)}
                className="-mx-1.5 flex max-w-full items-center gap-1 rounded-lg px-1.5 py-0.5 text-left transition-colors hover:bg-white/70 active:scale-[0.97]"
                aria-label="Switch space"
                aria-expanded={spaceMenuOpen}
              >
                <h1 className="truncate text-sm font-semibold text-slate-800">{spaceLabel}</h1>
                <ChevronDown
                  className={`h-3.5 w-3.5 flex-none text-violet-500 transition-transform duration-200 ${
                    spaceMenuOpen ? 'rotate-180' : ''
                  }`}
                />
              </button>
            ) : (
              <h1 className="truncate text-sm font-semibold text-slate-800">{spaceLabel}</h1>
            )}
            {activeChat?.title && (
              <p className="truncate text-xs text-slate-500">{activeChat.title}</p>
            )}
            {spaceMenuOpen && (
              <div className="absolute left-0 top-full z-40 mt-1 w-64 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
                <BatchMenuList
                  batches={batches}
                  selectedBatchId={selectedBatch?.id}
                  onSelect={(batch) => {
                    onSelectBatch(batch)
                    setSpaceMenuOpen(false)
                  }}
                />
              </div>
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
              panelOpen ? 'bg-violet-50 text-violet-700' : ''
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
                  <div className="absolute right-0 top-10 z-40 w-56 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-xl">
                    {lastUpdated && (
                      <div className="flex items-baseline justify-between gap-3 px-3 py-2">
                        <span className="text-[11px] text-slate-400">Last updated</span>
                        <span className="text-[11px] font-medium text-slate-600">{lastUpdated}</span>
                      </div>
                    )}
                    <div className="my-1 border-t border-slate-100" />

                    <button
                      type="button"
                      onClick={() => {
                        onStartRename(activeChat)
                        setMenuOpen(false)
                      }}
                      className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs text-slate-600 hover:bg-violet-50 hover:text-violet-900"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      Rename session
                    </button>

                    <div className="my-1 border-t border-slate-100" />
                    {/* Exports the whole conversation, not just the last turn. */}
                    {EXPORT_FORMATS.map((format) => {
                      const FormatIcon = EXPORT_FORMAT_ICONS[format]
                      return (
                        <button
                          key={format}
                          type="button"
                          disabled={exporting !== null}
                          onClick={() => void handleExport(format)}
                          className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs text-slate-600 hover:bg-violet-50 hover:text-violet-900 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {exporting === format ? (
                            <Spinner size={14} />
                          ) : (
                            <FormatIcon className="h-3.5 w-3.5 text-violet-600" />
                          )}
                          Export as {EXPORT_FORMAT_LABELS[format]}
                        </button>
                      )
                    })}

                    <div className="my-1 border-t border-slate-100" />
                    <button
                      type="button"
                      onClick={() => {
                        setConfirmDelete(true)
                        setMenuOpen(false)
                      }}
                      className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs text-red-500 hover:bg-red-50 hover:text-red-600"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Delete
                    </button>

                    {exportError && (
                      <p className="border-t border-slate-100 px-3 py-2 text-[11px] text-red-600">
                        {exportError}
                      </p>
                    )}
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
