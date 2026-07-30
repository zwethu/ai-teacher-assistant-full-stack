import { useEffect, useState } from 'react'
import { PawPrint } from '@phosphor-icons/react'
import Lottie from '../cat/LottieBox'
import loadingAnimation from '../../assets/animations/Animal care Loading.json'
import './PageSpinner.css'

interface PageSpinnerProps {
  label?: string
  /** Lines cycled under the label. Pass [] to show none. */
  tips?: string[]
}

const DEFAULT_TIPS = [
  'Warming up your learning buddy…',
  'Fetching your classes and assessments…',
  'Almost there — thanks for your patience!',
]

const TIP_INTERVAL_MS = 3200

export default function PageSpinner({ label = 'Loading…', tips = DEFAULT_TIPS }: PageSpinnerProps) {
  const [tipIndex, setTipIndex] = useState(0)

  // A still screen reads as "frozen" after a few seconds. Rotating copy is the
  // cheapest honest signal that the app is alive and hasn't hung.
  useEffect(() => {
    if (tips.length < 2) return
    const id = setInterval(() => setTipIndex(i => (i + 1) % tips.length), TIP_INTERVAL_MS)
    return () => clearInterval(id)
  }, [tips.length])

  return (
    <div className="loader-screen">
      {/* One live region for the whole card: screen readers get the label, and
          the decorative animation/paws stay out of the announcement. */}
      <div className="loader-card" role="status" aria-live="polite" aria-label={label}>
        <div className="loader-lottie" aria-hidden="true">
          <Lottie animationData={loadingAnimation as object} loop autoplay />
        </div>

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
