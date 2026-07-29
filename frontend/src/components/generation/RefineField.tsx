import { useState, type KeyboardEvent } from 'react'
import { Loader2, Send, X } from 'lucide-react'
import { ACCENT, type GenAccent } from './generationTheme'

/**
 * Controlled full-width "ask for changes" box for the workflow. The trigger lives
 * in the view's controls row; when opened this renders a roomy instruction box
 * below it (not a cramped inline field, and not a persistent chat composer).
 */
export function RefineField({
  accent,
  placeholder,
  disabled,
  open,
  onClose,
  onSubmit,
}: {
  accent: GenAccent
  placeholder?: string
  disabled?: boolean
  open: boolean
  onClose: () => void
  onSubmit: (text: string) => void
}) {
  const theme = ACCENT[accent]
  const [text, setText] = useState('')

  function submit() {
    const value = text.trim()
    if (!value || disabled) return
    onSubmit(value)
    setText('')
    onClose()
  }

  // Enter inserts newlines (this is a long box); Cmd/Ctrl+Enter submits.
  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      submit()
    }
  }

  if (!open) return null

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold text-slate-600">Describe the changes you want</span>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-0.5 text-slate-400 hover:text-slate-600"
          aria-label="Cancel"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <textarea
        autoFocus
        rows={4}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        className="block min-h-[7rem] w-full resize-y rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-400 focus:outline-none"
      />
      <div className="mt-2 flex items-center justify-between">
        <span className="text-[11px] text-slate-400">Press ⌘/Ctrl + Enter to send</span>
        <button
          type="button"
          onClick={submit}
          disabled={disabled || !text.trim()}
          className={`inline-flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-sm font-medium text-white shadow-sm disabled:opacity-50 ${theme.solid}`}
        >
          {disabled ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          Send
        </button>
      </div>
    </div>
  )
}
