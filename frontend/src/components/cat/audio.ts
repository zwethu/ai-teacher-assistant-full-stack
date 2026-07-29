// Shared audio plumbing for the game. One AudioContext and one mute switch,
// but TWO buses under the master so the mix can be balanced:
//
//   master ─┬─ music  (music.ts)  — background, deliberately quiet
//           └─ sfx    (juice.ts)  — the cues the player must actually hear
//
// The music bus also ducks: every sound effect dips it for a moment and lets
// it swell back. Without that, a continuous loop and a 70ms click compete at
// the same moment and the click loses.
//
// Browsers refuse to start audio before a user gesture, so the context is
// created lazily and resumed on the first click/keypress/touch.

const MUTE_KEY = 'catgame:muted';

// Background sits well under the effects. Raising MUSIC_LEVEL is the one knob
// to turn if the music ever needs to come forward again.
const MUSIC_LEVEL  = 0.34;
const MUSIC_DUCKED = 0.09;
const SFX_LEVEL    = 1;

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let music: GainNode | null = null;
let sfx: GainNode | null = null;
let muted = readMuted();
let duckTimer: ReturnType<typeof setTimeout> | undefined;

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

      music = ctx.createGain();
      music.gain.value = MUSIC_LEVEL;
      music.connect(master);

      sfx = ctx.createGain();
      sfx.gain.value = SFX_LEVEL;
      sfx.connect(master);
    }
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

/** Everything hangs off this; mute is applied here, once. */
export function masterGain(): GainNode | null {
  actx();
  return master;
}

/** Background music bus — quiet, and ducked while effects play. */
export function musicBus(): GainNode | null {
  actx();
  return music;
}

/** Sound-effect bus — the layer that has to cut through. */
export function sfxBus(): GainNode | null {
  actx();
  return sfx;
}

/**
 * Dip the music for `holdMs`, then swell it back. Called by every effect in
 * juice.ts. Overlapping calls just extend the dip — the timer is restarted,
 * never stacked, so the level can't creep downward.
 */
export function duckMusic(holdMs = 320) {
  const c = ctx;
  const g = music;
  if (!c || !g) return;
  g.gain.cancelScheduledValues(c.currentTime);
  g.gain.setTargetAtTime(MUSIC_DUCKED, c.currentTime, 0.03);
  clearTimeout(duckTimer);
  duckTimer = setTimeout(() => {
    if (!ctx || !music) return;
    music.gain.setTargetAtTime(MUSIC_LEVEL, ctx.currentTime, 0.22);
  }, holdMs);
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
