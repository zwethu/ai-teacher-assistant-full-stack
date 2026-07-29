import Lottie from './LottieBox';
import { endingAnimation } from './avatarAnimations';

// One-shot celebratory bird, shown over the arena when a submit locks in a
// correct pair. Mount with a changing `key` to replay it.
export default function BirdBurst() {
  return (
    <div className="bird-burst" aria-hidden>
      <Lottie animationData={endingAnimation} loop={false} autoplay />
    </div>
  );
}
