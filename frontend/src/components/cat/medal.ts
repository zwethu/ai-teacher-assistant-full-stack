import type { BehaviorSummary, MedalTier } from '../../types/catGame.types';

export type { MedalTier };

export type Medal = {
  tier: MedalTier;
  emoji: string;
  title: string;
  blurb: string;
};

// Medal — NOT a rank. Everyone earns one; copy stays encouraging.
// Priority that shapes it: correctness (primary) → fewer trials → less time.
export function computeMedal(accuracy: number, b?: BehaviorSummary): Medal {
  const trials    = b ? b.wrongSubmitCount : 0;
  const cleanRun  = trials === 0;
  const fast      = b && b.timeLimitMs > 0 ? b.durationMs <= b.timeLimitMs * 0.5 : false;

  if (accuracy >= 85) {
    return {
      tier: 'gold',
      emoji: '🥇',
      title: 'Gold Medal!',
      blurb:
        cleanRun && fast ? 'Flawless and fast — incredible focus!' :
        cleanRun         ? 'A clean run — beautifully done!' :
                           'Brilliant work, superstar!',
    };
  }
  if (accuracy >= 55) {
    return {
      tier: 'silver',
      emoji: '🥈',
      title: 'Silver Medal!',
      blurb: trials <= 1 ? 'Sharp thinking — so close to gold!' : 'Great effort — you worked it out!',
    };
  }
  return {
    tier: 'bronze',
    emoji: '🥉',
    title: 'Bronze Medal!',
    blurb: 'Every try makes you stronger — well played!',
  };
}

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}
