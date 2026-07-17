import Lottie from './LottieBox';
import type { CatMood, AvatarType } from '../../types/catGame.types';
import { avatarAnimation } from './avatarAnimations';

type Props = {
  mood: CatMood;
  species?: AvatarType;
  size?: 'normal' | 'result';
};

const MOOD_LABEL: Partial<Record<CatMood, string>> = {
  happy:    '✨ Yay!',
  confused: '😕 Hmm...',
  playful:  "🎉 Let's go!",
  eating:   '🐟 Nom nom!',
  sleeping: 'zzz...',
};

export default function CatSprite({ mood, species = 'cat', size = 'normal' }: Props) {
  const label     = mood !== 'idle' ? MOOD_LABEL[mood] : null;
  const animation = avatarAnimation(species, mood);

  return (
    <div className={`cat-sprite cat-sprite--${size} cat-sprite--${species} cat-mood-${mood}`}>
      <div className="cat-shadow" />
      <div className="cat-lottie">
        <Lottie animationData={animation as object} loop autoplay />
      </div>
      {label && <div className="cat-speech-bubble">{label}</div>}
    </div>
  );
}
