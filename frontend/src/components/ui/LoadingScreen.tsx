import { Spinner } from '../../design-system'

/**
 * Full-page loading state.
 *
 * The same surface the sign-in page sits on — `.academic-bg`, MILA's lavender
 * canvas with its 32px dotted grid — with the bead garland centred on it. That
 * continuity is the point: this screen is almost always the frame *before* the
 * sign-in page or the app shell, so landing on the same canvas reads as the
 * product loading rather than as a separate interstitial.
 *
 * The garland is the loading loader specifically; the thinking animation is a
 * different mark for agent work and the two are never interchangeable.
 *
 * `fixed inset-0` rather than `min-h-screen`: this renders while routing is
 * still resolving, so it must cover whatever is underneath regardless of what
 * the parent layout happens to be.
 */
export default function LoadingScreen({ label = 'Loading…' }: { label?: string }) {
  return (
    <div
      className="academic-bg fixed inset-0 z-50 flex flex-col items-center justify-center gap-5 font-sans"
      role="status"
      aria-live="polite"
    >
      <Spinner size={52} />
      <p className="text-sm font-medium text-slate-600">{label}</p>
    </div>
  )
}
