// Looping background music for the game flow. Three tracks:
//   menu → calm ambient pad (avatar / mode select, lobby screens)
//   cat  → light plucky pentatonic theme (in-game, cat avatar)
//   dog  → bouncier, faster theme (in-game, dog avatar)
//
// Each track has two sources, tried in order:
//   1. A real file at /audio/<name>.mp3 (drop one in frontend/public/audio/
//      and it takes over automatically — no code change needed).
//   2. A generated Web Audio loop, so the game has music with zero assets.
//
// Everything routes through the shared master bus in audio.ts, so the mute
// toggle covers music and sound effects together.
import { actx, masterGain, whenUnlocked } from './audio';

export type TrackId = 'menu' | 'cat' | 'dog';

const FILES: Record<TrackId, string> = {
  menu: '/audio/background.mp3',
  cat:  '/audio/cat-theme.mp3',
  dog:  '/audio/dog-theme.mp3',
};

// ─── Note helpers ─────────────────────────────────────────────────────────
const SEMITONE: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** 'C4' | 'F#3' → frequency in Hz (A4 = 440). */
function n(name: string): number {
  const m = /^([A-G])(#|b)?(-?\d)$/.exec(name);
  if (!m) return 440;
  const [, letter, accidental, octave] = m;
  let semi = SEMITONE[letter];
  if (accidental === '#') semi += 1;
  if (accidental === 'b') semi -= 1;
  const midi = semi + (Number(octave) + 1) * 12;
  return 440 * Math.pow(2, (midi - 69) / 12);
}

type Voice = { type: OscillatorType; vol: number; attack: number; release: number };
/** t and dur are in beats, so a track can be retimed by changing bpm alone. */
type Step = { t: number; note: string; dur: number };
type Part = { voice: Voice; steps: Step[] };
type Track = { bpm: number; beats: number; parts: Part[] };

function line(voice: Voice, steps: Step[]): Part {
  return { voice, steps };
}

/** Chord → one Step per note, all starting together. */
function chord(t: number, notes: string[], dur: number): Step[] {
  return notes.map(note => ({ t, note, dur }));
}

/** Evenly-spaced notes (walking bass, arpeggios). */
function pulse(notes: string[], dur: number, step = 1): Step[] {
  return notes.map((note, i) => ({ t: i * step, note, dur }));
}

// ─── The three tracks ─────────────────────────────────────────────────────
// All in C major so switching screens never sounds like a key change.
const TRACKS: Record<TrackId, Track> = {
  // Slow major-7th pad — meant to sit under menu chatter, not lead it.
  menu: {
    bpm: 66,
    beats: 16,
    parts: [
      line({ type: 'sine', vol: 0.05, attack: 0.6, release: 1.2 }, [
        ...chord(0,  ['C4', 'E4', 'G4', 'B4'], 3.5),
        ...chord(4,  ['A3', 'C4', 'E4', 'G4'], 3.5),
        ...chord(8,  ['F3', 'A3', 'C4', 'E4'], 3.5),
        ...chord(12, ['G3', 'B3', 'D4', 'E4'], 3.5),
      ]),
      line({ type: 'triangle', vol: 0.045, attack: 0.02, release: 0.8 }, [
        { t: 2, note: 'G5', dur: 1 },
        { t: 6, note: 'E5', dur: 1 },
        { t: 10, note: 'C5', dur: 1 },
        { t: 14, note: 'D5', dur: 1 },
      ]),
    ],
  },

  // Pentatonic (no semitone clashes) + soft triangle = light and catlike.
  cat: {
    bpm: 104,
    beats: 16,
    parts: [
      line({ type: 'triangle', vol: 0.10, attack: 0.01, release: 0.18 }, [
        { t: 0, note: 'E5', dur: 0.5 },   { t: 0.5, note: 'G5', dur: 0.5 },
        { t: 1, note: 'A5', dur: 1 },     { t: 2, note: 'G5', dur: 0.5 },
        { t: 2.5, note: 'E5', dur: 0.5 }, { t: 3, note: 'D5', dur: 1 },
        { t: 4, note: 'C5', dur: 0.5 },   { t: 4.5, note: 'E5', dur: 0.5 },
        { t: 5, note: 'G5', dur: 1 },     { t: 6, note: 'E5', dur: 1 },
        { t: 7, note: 'D5', dur: 1 },
        { t: 8, note: 'A4', dur: 0.5 },   { t: 8.5, note: 'C5', dur: 0.5 },
        { t: 9, note: 'D5', dur: 1 },     { t: 10, note: 'E5', dur: 0.5 },
        { t: 10.5, note: 'G5', dur: 0.5 }, { t: 11, note: 'A5', dur: 1 },
        { t: 12, note: 'G5', dur: 1 },    { t: 13, note: 'E5', dur: 1 },
        { t: 14, note: 'C5', dur: 2 },
      ]),
      line({ type: 'sine', vol: 0.07, attack: 0.01, release: 0.2 },
        pulse(['C3', 'G3', 'C3', 'E3', 'A2', 'E3', 'G2', 'C3'], 1.5, 2)),
    ],
  },

  // Faster, staccato, walking bass on every beat — reads as eager/bouncy.
  dog: {
    bpm: 126,
    beats: 16,
    parts: [
      // Square is harsh, so it runs at roughly half the triangle's volume.
      line({ type: 'square', vol: 0.055, attack: 0.005, release: 0.10 }, [
        { t: 0, note: 'C5', dur: 0.4 },   { t: 0.5, note: 'E5', dur: 0.4 },
        { t: 1, note: 'G5', dur: 0.4 },   { t: 1.5, note: 'E5', dur: 0.4 },
        { t: 2, note: 'C6', dur: 0.8 },   { t: 3, note: 'G5', dur: 0.4 },
        { t: 3.5, note: 'A5', dur: 0.4 },
        { t: 4, note: 'F5', dur: 0.4 },   { t: 4.5, note: 'A5', dur: 0.4 },
        { t: 5, note: 'C6', dur: 0.8 },   { t: 6, note: 'A5', dur: 0.4 },
        { t: 6.5, note: 'F5', dur: 0.4 }, { t: 7, note: 'G5', dur: 0.8 },
        { t: 8, note: 'E5', dur: 0.4 },   { t: 8.5, note: 'G5', dur: 0.4 },
        { t: 9, note: 'C6', dur: 0.8 },   { t: 10, note: 'B5', dur: 0.4 },
        { t: 10.5, note: 'G5', dur: 0.4 }, { t: 11, note: 'D5', dur: 0.8 },
        { t: 12, note: 'F5', dur: 0.4 },  { t: 12.5, note: 'E5', dur: 0.4 },
        { t: 13, note: 'D5', dur: 0.4 },  { t: 13.5, note: 'C5', dur: 0.4 },
        { t: 14, note: 'C5', dur: 1.6 },
      ]),
      line({ type: 'triangle', vol: 0.09, attack: 0.005, release: 0.09 },
        pulse(['C3', 'G2', 'C3', 'G2', 'F2', 'C3', 'F2', 'C3',
               'C3', 'G2', 'C3', 'G2', 'F2', 'G2', 'C3', 'C3'], 0.35)),
    ],
  },
};

// ─── Synth playback ───────────────────────────────────────────────────────
function playNote(c: AudioContext, bus: GainNode, v: Voice, freq: number, at: number, dur: number) {
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = v.type;
  osc.frequency.setValueAtTime(freq, at);
  // exponentialRamp can't touch zero, hence the 0.0001 floor.
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(v.vol, at + v.attack);
  gain.gain.setValueAtTime(v.vol, at + Math.max(v.attack, dur));
  gain.gain.exponentialRampToValueAtTime(0.0001, at + Math.max(v.attack, dur) + v.release);
  osc.connect(gain);
  gain.connect(bus);
  osc.start(at);
  osc.stop(at + Math.max(v.attack, dur) + v.release + 0.02);
}

/** Schedules the loop bar-by-bar and returns a stop fn. */
function startSynth(track: Track): () => void {
  const c = actx();
  const bus = masterGain();
  if (!c || !bus) return () => {};

  const trackGain = c.createGain();
  trackGain.gain.setValueAtTime(0.0001, c.currentTime);
  trackGain.gain.exponentialRampToValueAtTime(1, c.currentTime + 1.2); // fade in
  trackGain.connect(bus);

  const beat = 60 / track.bpm;
  const loopDur = track.beats * beat;
  let nextStart = c.currentTime + 0.1;
  let timer: ReturnType<typeof setTimeout>;

  // Schedule one loop, then wake up shortly before it ends to queue the next.
  // Audio-clock scheduling (not setInterval) is what keeps the timing steady.
  const scheduleLoop = () => {
    for (const part of track.parts) {
      for (const s of part.steps) {
        playNote(c, trackGain, part.voice, n(s.note), nextStart + s.t * beat, s.dur * beat);
      }
    }
    nextStart += loopDur;
    timer = setTimeout(scheduleLoop, Math.max(50, (nextStart - c.currentTime - 0.3) * 1000));
  };
  scheduleLoop();

  return () => {
    clearTimeout(timer);
    trackGain.gain.cancelScheduledValues(c.currentTime);
    trackGain.gain.setTargetAtTime(0, c.currentTime, 0.15);
    setTimeout(() => trackGain.disconnect(), 900);
  };
}

// ─── File playback ────────────────────────────────────────────────────────
const fileChecks = new Map<TrackId, Promise<boolean>>();
const elements = new Map<TrackId, HTMLAudioElement>();

/**
 * True only if a real audio file is served at the track's path.
 * The content-type check matters: the dev server answers missing paths with
 * index.html and a 200, so `res.ok` alone would report every file as present.
 */
function hasFile(id: TrackId): Promise<boolean> {
  let check = fileChecks.get(id);
  if (!check) {
    check = fetch(FILES[id], { method: 'HEAD' })
      .then(res => res.ok && (res.headers.get('content-type') ?? '').startsWith('audio'))
      .catch(() => false);
    fileChecks.set(id, check);
  }
  return check;
}

function startFile(id: TrackId): () => void {
  const c = actx();
  const bus = masterGain();
  if (!c || !bus) return () => {};

  let el = elements.get(id);
  if (!el) {
    el = new Audio(FILES[id]);
    el.loop = true;
    el.preload = 'auto';
    elements.set(id, el);
    // createMediaElementSource throws if called twice for one element, so the
    // element is cached and wired exactly once.
    c.createMediaElementSource(el).connect(bus);
  }
  el.currentTime = 0;
  void el.play().catch(() => {/* gesture not registered yet; mute toggle recovers */});

  const stopEl = el;
  return () => stopEl.pause();
}

// ─── Public API ───────────────────────────────────────────────────────────
let currentId: TrackId | null = null;
let stopCurrent: (() => void) | null = null;

/** Start (or switch to) a track. No-op if it's already the one playing. */
export function playMusic(id: TrackId) {
  if (currentId === id) return;
  stopMusic();
  currentId = id;

  whenUnlocked(() => {
    if (currentId !== id) return;           // switched again while waiting for a gesture
    void hasFile(id).then(exists => {
      if (currentId !== id) return;         // ...or while probing for the file
      stopCurrent = exists ? startFile(id) : startSynth(TRACKS[id]);
    });
  });
}

export function stopMusic() {
  stopCurrent?.();
  stopCurrent = null;
  currentId = null;
}

export function currentTrack(): TrackId | null {
  return currentId;
}
