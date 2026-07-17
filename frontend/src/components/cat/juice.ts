// Lightweight game "juice": synth sound effects + haptic buzz.
// Context, master bus and mute live in audio.ts and are shared with music.ts.
import { actx, masterGain } from './audio';

function tone(freq: number, start: number, dur: number, type: OscillatorType = 'sine', vol = 0.2) {
  const c = actx();
  const bus = masterGain();
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
  tone(520, 0, 0.06, 'sine', 0.13);
  tone(700, 0.05, 0.07, 'sine', 0.10);
  buzz(15);
}

export function playCorrect() {
  tone(660, 0, 0.12, 'triangle', 0.18);
  tone(880, 0.1, 0.16, 'triangle', 0.18);
  buzz(30);
}

export function playWrong() {
  tone(200, 0, 0.18, 'sawtooth', 0.14);
  tone(150, 0.12, 0.2, 'sawtooth', 0.12);
  buzz([40, 40, 40]);
}

export function playWin() {
  [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.12, 0.24, 'triangle', 0.2));
  buzz([30, 50, 30, 90]);
}
