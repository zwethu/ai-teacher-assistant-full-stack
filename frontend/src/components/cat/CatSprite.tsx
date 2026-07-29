import Lottie from './LottieBox';
import type { CatMood, AvatarType } from '../../types/catGame.types';
import { avatarAnimation } from './avatarAnimations';

type Props = {
  mood: CatMood;
  species?: AvatarType;
  size?: 'normal' | 'result' | 'game';
  /** Persistent line the pet "says" (e.g. a how-to hint). A live mood
   *  reaction (Yay!/Hmm…) briefly takes over the bubble when one fires. */
  hint?: string;
};

const MOOD_LABEL: Partial<Record<CatMood, string>> = {
  happy:    '✨ Yay!',
  confused: '😕 Hmm...',
  playful:  "🎉 Let's go!",
  eating:   '🐟 Nom nom!',
  // 'sleeping' deliberately has no label — the closed-assessment screen shows
  // the resting pet on its own, without a bubble.
};

export default function CatSprite({ mood, species = 'cat', size = 'normal', hint }: Props) {
  const label     = mood !== 'idle' ? MOOD_LABEL[mood] : null;
  const bubble    = label ?? hint ?? null;   // mood reaction wins; else the hint
  const animation = avatarAnimation(species, mood);

  return (
    <div className={`cat-sprite cat-sprite--${size} cat-sprite--${species} cat-mood-${mood}`}>
      <div className="cat-shadow" />
      <div className="cat-lottie">
        <Lottie animationData={animation as object} loop autoplay />
      </div>
      {bubble && (
        <div className={`cat-speech-bubble${label ? '' : ' cat-speech-bubble--hint'}`}>
          {bubble}
        </div>
      )}
    </div>
  );
}
