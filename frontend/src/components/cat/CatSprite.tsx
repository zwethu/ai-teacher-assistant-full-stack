import { useEffect, useState } from 'react';

type CatSpriteProps = {
  mood: 'idle' | 'happy' | 'confused' | 'playful' | 'eating';
};

type RandomBehavior = {
  emoji: string;
  label: string;
  bodyClass: string;
};

const RANDOM_BEHAVIORS: RandomBehavior[] = [
  { emoji: '😸', label: '*purr purr purr*', bodyClass: 'purring' },
  { emoji: '😺', label: 'Meow~', bodyClass: 'meowing' },
  { emoji: '🙂‍↕️', label: 'slow blink... ♡', bodyClass: 'blinking' },
  { emoji: '😹', label: 'hehe', bodyClass: 'smiling' },
  { emoji: '😻', label: '(shows belly)', bodyClass: 'belly' },
  { emoji: '🐱', label: 'chirp!', bodyClass: 'chirping' },
];

const MOOD_CONFIG: Record<string, { emoji: string; label: string; bodyClass: string }> = {
  idle:     { emoji: '😺', label: '',                bodyClass: '' },
  happy:    { emoji: '😸', label: '✨ Purr!',        bodyClass: 'happy' },
  confused: { emoji: '😿', label: '😕 Hmm...',       bodyClass: 'confused' },
  playful:  { emoji: '🙀', label: '🎉 Yay!',         bodyClass: 'playful' },
  eating:   { emoji: '😋', label: '🐟 Nom nom nom!', bodyClass: 'eating' },
};

export default function CatSprite({ mood }: CatSpriteProps) {
  const [random, setRandom] = useState<RandomBehavior | null>(null);

  useEffect(() => {
    if (mood !== 'idle') {
      setRandom(null);
      return;
    }
    const schedule = () => {
      const delay = 3000 + Math.random() * 5000;
      return setTimeout(() => {
        const behavior = RANDOM_BEHAVIORS[Math.floor(Math.random() * RANDOM_BEHAVIORS.length)];
        setRandom(behavior);
        setTimeout(() => {
          setRandom(null);
          timer = schedule();
        }, 2200);
      }, delay);
    };
    let timer = schedule();
    return () => clearTimeout(timer);
  }, [mood]);

  const active = mood !== 'idle' ? MOOD_CONFIG[mood] : (random ?? MOOD_CONFIG.idle);

  return (
    <div className={`cat-sprite cat-body-${active.bodyClass || 'idle'}`}>
      <div className="cat-shadow" />
      <div className="cat-emoji">{active.emoji}</div>
      {active.label && (
        <div className="cat-speech-bubble">{active.label}</div>
      )}
    </div>
  );
}
