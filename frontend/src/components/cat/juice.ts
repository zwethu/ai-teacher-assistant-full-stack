// Lightweight game "juice": synth sound effects + haptic buzz.
// Context, master bus and mute live in audio.ts and are shared with music.ts.
import { actx, sfxBus, duckMusic } from './audio';

function tone(freq: number, start: number, dur: number, type: OscillatorType = 'sine', vol = 0.2) {
  const c = actx();
  const bus = sfxBus();
  if (!c || !bus) return;
  const t0 = c.currentTime + start;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(gain);
  gain.connect(bus);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

export function buzz(pattern: number | number[]) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* unsupported */
  }
}

/** Fires the moment the player pairs / links / drops an item — the "it landed"
 *  cue. Deliberately the SAME sound whether the match is right or wrong: during
 *  play, audio must not leak correctness any more than colour does. The reward
 *  chime stays at submit, where feedback is earned. */
export function playSnap() {
  // Each cue ducks the music for roughly its own length (see duckMusic) — a
  // short click can't win against a continuous loop on volume alone.
  duckMusic(280);
  // Triangle, not sine: the extra harmonics read over a melody sitting in the
  // same octave, where a pure sine just blends into it.
  tone(520, 0, 0.09, 'triangle', 0.26);
  tone(700, 0.06, 0.10, 'triangle', 0.21);
  buzz(15);
}

/** The mirror of playSnap: fired when the player takes a pairing back apart.
 *  Same two notes, descending instead of rising, and softer — undoing is a
 *  correction, not an event worth the same weight as making the link. Like the
 *  snap it is state-blind: unlinking a right answer sounds like unlinking a
 *  wrong one, so the cue can't be used to probe the board. */
export function playUnsnap() {
  duckMusic(260);
  tone(620, 0, 0.09, 'triangle', 0.18);
  tone(420, 0.06, 0.11, 'triangle', 0.15);
  buzz(12);
}

/** Round cleared — every item on the board came back correct. Fires with the
 *  flock of birds, so it's a real (if short) fanfare: five rising notes, not
 *  the old two-note ping. Deliberately smaller than playWin, which still has
 *  to feel like the bigger moment at the end of the whole run. */
export function playRoundClear() {
  duckMusic(900);
  [659, 784, 988, 1175].forEach((f, i) => tone(f, i * 0.09, 0.2, 'triangle', 0.3));
  // A sparkle a fifth above the last note, quieter — reads as "shine", not a
  // fifth melody note.
  tone(1568, 0.42, 0.3, 'sine', 0.16);
  buzz([25, 40, 25]);
}

export function playWrong() {
  // Longest duck of the three in-play cues: a sawtooth in the bass sits in the
  // same register as the music's bass line, so it needs the room.
  duckMusic(650);
  tone(200, 0, 0.18, 'sawtooth', 0.24);
  tone(150, 0.12, 0.2, 'sawtooth', 0.21);
  // Runs alongside the screen shake in CatGame: on a phone the buzz IS the
  // shake, so it's a firmer double-thud than the incidental cues above. Timed
  // to the 0.5s shake (60 + 45 + 120 + 40 + 90 ≈ 355ms of it).
  buzz([60, 45, 120, 40, 90]);
}

export function playWin() {
  duckMusic(1100);   // four-note fanfare, ~0.7s of notes plus their tails
  [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.12, 0.24, 'triangle', 0.34));
  buzz([30, 50, 30, 90]);
}
