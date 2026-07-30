import Lottie from './LottieBox';
import { endingAnimation } from './avatarAnimations';

// Small one-shot bird that overlays a single card when it turns correct.
export default function CardBird() {
  return (
    <span className="card-bird" aria-hidden>
      <Lottie animationData={endingAnimation} loop={false} autoplay />
    </span>
  );
}
