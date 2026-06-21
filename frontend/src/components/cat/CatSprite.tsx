import { useEffect, useState } from 'react';

type CatSpriteProps = {
  mood: 'idle' | 'happy' | 'confused' | 'playful' | 'eating' | 'sleeping';
};

type RandomBehavior = {
  emoji: string;
  label: string;
  bodyClass: string;
};

const RANDOM_BEHAVIORS: RandomBehavior[] = [
  { emoji: '😸', label: '*purr purr purr*', bodyClass: 'purring' },
  { emoji: '😺', label: 'Meow~',            bodyClass: 'meowing' },
  { emoji: '🙂\u200d↕️', label: 'slow blink... ♡', bodyClass: 'blinking' },
  { emoji: '😹', label: 'hehe',             bodyClass: 'smiling' },
  { emoji: '😻', label: '(shows belly)',    bodyClass: 'belly' },
  { emoji: '🐱', label: 'chirp!',           bodyClass: 'chirping' },
];

const MOOD_CONFIG: Record<string, { emoji: string; label: string; bodyClass: string }> = {
  idle:     { emoji: '😺', label: '',                bodyClass: '' },
  happy:    { emoji: '😸', label: '✨ Purr!',        bodyClass: 'happy' },
  confused: { emoji: '😿', label: '😕 Hmm...',       bodyClass: 'confused' },
  playful:  { emoji: '🙀', label: '🎉 Yay!',         bodyClass: 'playful' },
  eating:   { emoji: '😋', label: '🐟 Nom nom nom!', bodyClass: 'eating' },
  sleeping: { emoji: '',   label: '',               bodyClass: 'sleeping' },
};

// SVG cat face with closed eyes for sleeping
function SleepingCatFace() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 100 100"
      width="104"
      height="104"
      style={{ display: 'block', filter: 'drop-shadow(0 4px 8px rgba(0,0,0,0.1))' }}
    >
      {/* Ears */}
      <polygon points="18,38 8,12 34,28" fill="#f4a261" />
      <polygon points="22,36 14,18 32,28" fill="#ffcba4" />
      <polygon points="82,38 92,12 66,28" fill="#f4a261" />
      <polygon points="78,36 86,18 68,28" fill="#ffcba4" />

      {/* Head */}
      <circle cx="50" cy="58" r="36" fill="#f4a261" />

      {/* Face fur patch */}
      <ellipse cx="50" cy="62" rx="22" ry="18" fill="#ffcba4" />

      {/* Closed eyes — curved lines like ◡ ◡ */}
      <path d="M30 52 Q36 46 42 52" stroke="#5a3825" stroke-width="2.8" fill="none" stroke-linecap="round" />
      <path d="M58 52 Q64 46 70 52" stroke="#5a3825" stroke-width="2.8" fill="none" stroke-linecap="round" />

      {/* Eyelashes */}
      <line x1="30" y1="52" x2="27" y2="49" stroke="#5a3825" stroke-width="1.8" stroke-linecap="round" />
      <line x1="42" y1="52" x2="45" y2="49" stroke="#5a3825" stroke-width="1.8" stroke-linecap="round" />
      <line x1="58" y1="52" x2="55" y2="49" stroke="#5a3825" stroke-width="1.8" stroke-linecap="round" />
      <line x1="70" y1="52" x2="73" y2="49" stroke="#5a3825" stroke-width="1.8" stroke-linecap="round" />

      {/* Nose */}
      <ellipse cx="50" cy="60" rx="3.5" ry="2.5" fill="#e07b8a" />

      {/* Mouth — slight smile */}
      <path d="M44 65 Q50 70 56 65" stroke="#c2556a" stroke-width="2" fill="none" stroke-linecap="round" />

      {/* Whiskers left */}
      <line x1="46" y1="61" x2="20" y2="57" stroke="#c2a07a" stroke-width="1.4" stroke-linecap="round" opacity="0.7" />
      <line x1="46" y1="63" x2="20" y2="64" stroke="#c2a07a" stroke-width="1.4" stroke-linecap="round" opacity="0.7" />
      <line x1="46" y1="65" x2="20" y2="71" stroke="#c2a07a" stroke-width="1.4" stroke-linecap="round" opacity="0.7" />

      {/* Whiskers right */}
      <line x1="54" y1="61" x2="80" y2="57" stroke="#c2a07a" stroke-width="1.4" stroke-linecap="round" opacity="0.7" />
      <line x1="54" y1="63" x2="80" y2="64" stroke="#c2a07a" stroke-width="1.4" stroke-linecap="round" opacity="0.7" />
      <line x1="54" y1="65" x2="80" y2="71" stroke="#c2a07a" stroke-width="1.4" stroke-linecap="round" opacity="0.7" />
    </svg>
  );
}

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
      {mood === 'sleeping' ? (
        <div className="cat-emoji">
          <SleepingCatFace />
        </div>
      ) : (
        <div className="cat-emoji">{active.emoji}</div>
      )}
      {mood === 'sleeping' && (
        <div className="cat-zzz-wrap">
          <span className="cat-zzz cat-zzz-1">z</span>
          <span className="cat-zzz cat-zzz-2">z</span>
          <span className="cat-zzz cat-zzz-3">Z</span>
        </div>
      )}
      {active.label && (
        <div className="cat-speech-bubble">{active.label}</div>
      )}
    </div>
  );
}
