import { X } from 'lucide-react'
import type { ToastMessage } from '../../types'

interface ToastProps {
  toast: ToastMessage | null
  onDismiss: () => void
}

export default function Toast({ toast, onDismiss }: ToastProps) {
  if (!toast) return null

  const isError = toast.type === 'error'

  return (
    <div
      className={`fixed bottom-6 right-6 z-[100] max-w-sm rounded-xl border px-4 py-3 shadow-lg flex items-start gap-3 ${
        isError
          ? 'bg-red-50 border-red-200 text-red-800'
          : 'bg-emerald-50 border-emerald-200 text-emerald-800'
      }`}
      role="status"
    >
      <p className="text-sm font-medium flex-1">{toast.message}</p>
      <button
        type="button"
        onClick={onDismiss}
        className="p-1 rounded-md hover:bg-black/5"
        aria-label="Dismiss"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  )
}
