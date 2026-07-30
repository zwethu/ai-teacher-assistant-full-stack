import type { CSSProperties } from 'react';

// Same palette as <Confetti/> (the game's --g-* accents) so the burst never
// looks off-brand. A party-popper cannon, not falling rain: pieces shoot out
// from the two bottom corners, arc up, then fall — fired as the medal pops in.
const COLORS = ['#f4739e', '#ffcc57', '#4fc992', '#5ea8f0', '#ffc2d6', '#ffe6a3', '#b6eed3'];

const CANNONS = [
  { sign: 1,  className: 'popper-origin--left'  }, // bottom-left → shoots up-right
  { sign: -1, className: 'popper-origin--right' }, // bottom-right → shoots up-left
] as const;

/** One-shot birthday confetti-cannon burst. Deterministic (index-based). */
export default function PartyPopper({ perCannon = 30 }: { perCannon?: number }) {
  return (
    <div className="popper-layer" aria-hidden>
      {CANNONS.map(({ sign, className }) => (
        <div key={className} className={`popper-origin ${className}`}>
          {Array.from({ length: perCannon }, (_, i) => {
            const f      = perCannon > 1 ? i / (perCannon - 1) : 0;
            const angle  = (20 + f * 60) * (Math.PI / 180);  // elevation 20°..80°
            const dist   = 220 + (i % 5) * 48;
            const tx     = sign * Math.cos(angle) * dist;
            const ty     = -Math.sin(angle) * dist;          // up = negative
            const fall   = 320 + (i % 4) * 80;               // gravity drop
            const rot    = ((i * 67) % 720) - 360;
            const dur    = 1.25 + (i % 5) * 0.13;
            const delay  = (i % 3) * 0.05;
            const color  = COLORS[i % COLORS.length];
            const streamer = i % 4 === 0;
            return (
              <span
                key={i}
                className={`popper-piece${streamer ? ' popper-piece--streamer' : ''}`}
                style={{
                  background: color,
                  animationDuration: `${dur}s`,
                  animationDelay: `${delay}s`,
                  '--tx': `${tx.toFixed(1)}px`,
                  '--ty': `${ty.toFixed(1)}px`,
                  '--fall': `${fall}px`,
                  '--rot': `${rot}deg`,
                } as CSSProperties}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}
