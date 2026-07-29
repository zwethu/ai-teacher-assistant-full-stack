import { Toast as MilaToast } from '../../design-system'
import type { ToastMessage } from '../../types'

interface ToastProps {
  toast: ToastMessage | null
  onDismiss: () => void
}

/**
 * App toast — the design system's Toast in a fixed-position slot.
 *
 * The DS component supplies the frosted surface, the coloured accent edge and
 * the status icon; this wrapper only decides where it sits. Success keeps
 * emerald (MILA's one remaining role for it) and errors are red.
 */
export default function Toast({ toast, onDismiss }: ToastProps) {
  if (!toast) return null

  return (
    <div className="fixed bottom-6 right-6 z-[100] max-w-sm">
      <MilaToast
        type={toast.type === 'error' ? 'error' : 'success'}
        message={toast.message}
        onDismiss={onDismiss}
      />
    </div>
  )
}
