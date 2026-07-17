// Shared audio plumbing for the game: one AudioContext, one master gain,
// one mute switch covering both sfx (juice.ts) and music (music.ts).
//
// Browsers refuse to start audio before a user gesture, so the context is
// created lazily and resumed on the first click/keypress/touch.

const MUTE_KEY = 'catgame:muted';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = readMuted();

const listeners = new Set<(muted: boolean) => void>();
const unlockQueue: Array<() => void> = [];
let unlockBound = false;

function readMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

/** The shared context, or null if Web Audio is unavailable. */
export function actx(): AudioContext | null {
  try {
    if (!ctx) {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      ctx = new Ctor();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 1;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

/** Bus every sound should connect to, so mute and volume apply once. */
export function masterGain(): GainNode | null {
  actx();
  return master;
}

/**
 * Run `fn` once audio is actually allowed to play. If the context is already
 * running it fires immediately; otherwise it waits for the first user gesture.
 * Used by music.ts so a track requested on page load still starts on first click.
 */
export function whenUnlocked(fn: () => void) {
  const c = actx();
  if (c && c.state === 'running') {
    fn();
    return;
  }
  unlockQueue.push(fn);
  if (unlockBound) return;
  unlockBound = true;

  const unlock = () => {
    const c2 = actx();
    if (!c2) return;
    void c2.resume().then(() => {
      if (c2.state !== 'running') return;
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
      window.removeEventListener('touchstart', unlock);
      unlockBound = false;
      while (unlockQueue.length) unlockQueue.shift()?.();
    });
  };

  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
  window.addEventListener('touchstart', unlock);
}

export function isMuted(): boolean {
  return muted;
}

export function setMuted(next: boolean) {
  muted = next;
  try {
    localStorage.setItem(MUTE_KEY, next ? '1' : '0');
  } catch {
    /* storage blocked — mute still applies for this session */
  }
  const g = master;
  const c = ctx;
  if (g && c) {
    // Ramp rather than snap: an instant gain jump clicks audibly.
    g.gain.cancelScheduledValues(c.currentTime);
    g.gain.setTargetAtTime(next ? 0 : 1, c.currentTime, 0.02);
  }
  listeners.forEach(l => l(next));
}

export function toggleMuted(): boolean {
  setMuted(!muted);
  return muted;
}

/** Subscribe to mute changes; returns an unsubscribe fn. */
export function onMuteChange(fn: (muted: boolean) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
