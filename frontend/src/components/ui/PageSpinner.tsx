import { useEffect, useState } from 'react'
import { PawPrint } from '@phosphor-icons/react'
import type { AvatarType } from '../../types/catGame.types'
import './PageSpinner.css'

interface PageSpinnerProps {
  label?: string
  /** Lines cycled under the label. Pass [] to show none. */
  tips?: string[]
  /** Which pet the player picked. Drives the one accent colour on this screen:
   *  pink for the cat, blue for the dog. Defaults to cat, same as the game. */
  avatar?: AvatarType
}

const DEFAULT_TIPS = [
  'Warming up your learning buddy…',
  'Fetching your classes and assessments…',
  'Almost there — thanks for your patience!',
]

const TIP_INTERVAL_MS = 3200

export default function PageSpinner({
  label = 'Loading…',
  tips = DEFAULT_TIPS,
  avatar = 'cat',
}: PageSpinnerProps) {
  const [tipIndex, setTipIndex] = useState(0)

  // A still screen reads as "frozen" after a few seconds. Rotating copy is the
  // cheapest honest signal that the app is alive and hasn't hung.
  useEffect(() => {
    if (tips.length < 2) return
    const id = setInterval(() => setTipIndex(i => (i + 1) % tips.length), TIP_INTERVAL_MS)
    return () => clearInterval(id)
  }, [tips.length])

  // The theme class goes on the outer element so every token below it — bar,
  // track, paws — recomputes against the chosen pet's ramp.
  return (
    <div className={`loader-screen theme-${avatar}`}>
      {/* One live region for the whole card: screen readers get the label, and
          the decorative bar/paws stay out of the announcement. */}
      <div className="loader-card" role="status" aria-live="polite" aria-label={label}>
        <p className="loader-label">{label}</p>

        <div className="loader-bar" aria-hidden="true" />

        <div className="loader-paws" aria-hidden="true">
          <span className="loader-paw"><PawPrint size={16} weight="fill" /></span>
          <span className="loader-paw"><PawPrint size={16} weight="fill" /></span>
          <span className="loader-paw"><PawPrint size={16} weight="fill" /></span>
        </div>

        {tips.length > 0 && (
          <p className="loader-tip">
            {/* key remounts the span so the fade-in replays on each tip */}
            <span className="loader-tip-text" key={tipIndex}>{tips[tipIndex]}</span>
          </p>
        )}
      </div>
    </div>
  )
}
