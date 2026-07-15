// Lightweight game "juice": synth sound effects + haptic buzz.
// One shared AudioContext, unlocked on first user gesture (clicks precede all sfx).
let ctx: AudioContext | null = null;

function actx(): AudioContext | null {
  try {
    if (!ctx) ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(freq: number, start: number, dur: number, type: OscillatorType = 'sine', vol = 0.2) {
  const c = actx();
  if (!c) return;
  const t0 = c.currentTime + start;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(gain);
  gain.connect(c.destination);
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
