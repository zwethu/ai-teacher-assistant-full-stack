import type { AvatarType, CatMood } from '../../types/catGame.types';

// Bundled Lottie animations (imported = parsed JSON object, no runtime fetch)
import catIdle from '../../assets/animations/cat/idle.json';
import catHappy from '../../assets/animations/cat/happy.json';
import catAngry from '../../assets/animations/cat/angry.json';
import dogIdle from '../../assets/animations/dog/idle.json';
import dogHappy from '../../assets/animations/dog/happy.json';
import dogAngry from '../../assets/animations/dog/angry.json';
import birdEnding from '../../assets/animations/ending/bird.json';

// We only have 3 clips per avatar, so the app's 6 moods collapse into 3 buckets.
export type MoodBucket = 'idle' | 'happy' | 'angry';

const ANIMATIONS: Record<AvatarType, Record<MoodBucket, unknown>> = {
  cat: { idle: catIdle, happy: catHappy, angry: catAngry },
  dog: { idle: dogIdle, happy: dogHappy, angry: dogAngry },
};

// idle/playful/eating/sleeping → calm idle; happy → happy; confused → angry (mistake)
export function moodToBucket(mood: CatMood): MoodBucket {
  if (mood === 'happy') return 'happy';
  if (mood === 'confused') return 'angry';
  return 'idle';
}

export function avatarAnimation(species: AvatarType, mood: CatMood): unknown {
  return ANIMATIONS[species][moodToBucket(mood)];
}

// Shared celebratory ending for both avatars, shown on the result screen.
export const endingAnimation = birdEnding;

// Friendly display metadata for the avatar-select screen.
export const AVATARS: { type: AvatarType; label: string; emoji: string; blurb: string }[] = [
  { type: 'cat', label: 'Cat Buddy', emoji: '🐱', blurb: 'Curious, clever, and a little mischievous.' },
  { type: 'dog', label: 'Dog Buddy', emoji: '🐶', blurb: 'Loyal, cheerful, and always cheering you on.' },
];
