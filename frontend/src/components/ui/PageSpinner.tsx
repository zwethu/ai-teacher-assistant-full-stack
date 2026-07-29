import { Spinner } from '../../design-system'

interface PageSpinnerProps {
  label?: string
}

/**
 * Full-screen loading state.
 *
 * The loader itself is the design system's bead garland — at 44 px it plays the
 * full "garland strings itself" sequence. This wrapper only supplies the
 * academic canvas and full-height centring, which the DS PageSpinner (a padded
 * inline block) deliberately does not.
 *
 * Loading uses `Spinner`; agent work uses `Thinking`. They are never swapped.
 */
export default function PageSpinner({ label = 'Loading…' }: PageSpinnerProps) {
  return (
    <div className="academic-bg min-h-screen flex flex-col items-center justify-center gap-4">
      <Spinner size={44} role="status" aria-label={label} />
      <p className="text-sm font-medium text-slate-600">{label}</p>
    </div>
  )
}
