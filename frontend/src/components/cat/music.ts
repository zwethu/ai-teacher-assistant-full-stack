// Looping background music for the game flow. ONE track per pet — there is no
// separate lobby track: every screen from avatar-select onward plays the theme
// of the pet in play (avatar-select previews whichever card is picked).
//   cat → skippy pentatonic romp
//   dog → faster, driving eighths
//
// Both are drum-driven rather than pad-driven: feedback on the first pass was
// that the synth themes were "too dramatic and cozy".
//
// Each track has two sources, tried in order:
//   1. A real file at /audio/<name>.mp3 (drop one in frontend/public/audio/
//      and it takes over automatically — no code change needed).
//   2. A generated Web Audio loop, so the game has music with zero assets.
//
// Everything routes through the shared music bus in audio.ts (which hangs off
// the master, so one mute still covers music and sound effects together). That
// bus is what holds music under the effects and ducks it while they play —
// which is also why a drop-in .mp3 gets the same treatment as the synth.
import { actx, musicBus, whenUnlocked } from './audio';

// Same values as AvatarType, deliberately: the track IS the pet.
export type TrackId = 'cat' | 'dog';

const FILES: Record<TrackId, string> = {
  cat: '/audio/cat.mp3',
  dog: '/audio/dog.mp3',
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
/** The groove layer. This is what separates "cozy" from "energetic" far more
 *  than tempo does — a pad at 140bpm is still a pad. */
type DrumKind = 'kick' | 'snare' | 'hat' | 'hatOpen';
type Hit = { t: number; kind: DrumKind; vol?: number };
type Track = { bpm: number; beats: number; parts: Part[]; drums?: Hit[] };

function line(voice: Voice, steps: Step[]): Part {
  return { voice, steps };
}

/** A hit every `step` beats across the loop (hats, four-on-the-floor kicks). */
function every(step: number, beats: number, kind: DrumKind, vol = 1, from = 0): Hit[] {
  const out: Hit[] = [];
  for (let t = from; t < beats; t += step) out.push({ t, kind, vol });
  return out;
}

/** Hits at named beats (backbeat snares, pickup kicks). */
function hits(times: number[], kind: DrumKind, vol = 1): Hit[] {
  return times.map(t => ({ t, kind, vol }));
}

/** Evenly-spaced notes (walking bass, arpeggios). */
function pulse(notes: string[], dur: number, step = 1): Step[] {
  return notes.map((note, i) => ({ t: i * step, note, dur }));
}

// ─── The two tracks ───────────────────────────────────────────────────────
// Both in C major so switching pets never sounds like a key change, and both
// 16 beats = 4 bars long. Common shape: staccato lead, eighth-note bass, and a
// kick/snare/hat groove. Nothing sustains for more than a beat — held notes
// are what made the old versions read as "ambient".
const TRACKS: Record<TrackId, Track> = {
  // Pentatonic (no semitone clashes) but skippy now: dotted-eighth pickups and
  // a syncopated kick, so it romps rather than strolls.
  cat: {
    bpm: 138,
    beats: 16,
    parts: [
      line({ type: 'triangle', vol: 0.095, attack: 0.008, release: 0.14 }, [
        { t: 0, note: 'E5', dur: 0.4 },      { t: 0.5, note: 'G5', dur: 0.4 },
        { t: 0.75, note: 'A5', dur: 0.65 },  { t: 1.5, note: 'G5', dur: 0.4 },
        { t: 2, note: 'E5', dur: 0.4 },      { t: 2.5, note: 'D5', dur: 0.4 },
        { t: 3, note: 'E5', dur: 0.4 },      { t: 3.5, note: 'G5', dur: 0.4 },
        { t: 4, note: 'A5', dur: 0.4 },      { t: 4.5, note: 'C6', dur: 0.4 },
        { t: 4.75, note: 'A5', dur: 0.65 },  { t: 5.5, note: 'G5', dur: 0.4 },
        { t: 6, note: 'E5', dur: 0.4 },      { t: 6.5, note: 'G5', dur: 0.4 },
        { t: 7, note: 'D5', dur: 0.9 },
        { t: 8, note: 'C5', dur: 0.4 },      { t: 8.5, note: 'E5', dur: 0.4 },
        { t: 8.75, note: 'G5', dur: 0.65 },  { t: 9.5, note: 'E5', dur: 0.4 },
        { t: 10, note: 'D5', dur: 0.4 },     { t: 10.5, note: 'C5', dur: 0.4 },
        { t: 11, note: 'D5', dur: 0.4 },     { t: 11.5, note: 'E5', dur: 0.4 },
        { t: 12, note: 'G5', dur: 0.4 },     { t: 12.5, note: 'A5', dur: 0.4 },
        { t: 13, note: 'C6', dur: 0.65 },    { t: 13.75, note: 'A5', dur: 0.4 },
        { t: 14, note: 'G5', dur: 0.4 },     { t: 14.5, note: 'E5', dur: 0.4 },
        { t: 15, note: 'C5', dur: 0.9 },
      ]),
      line({ type: 'sine', vol: 0.075, attack: 0.005, release: 0.1 },
        pulse(['C3', 'G2', 'C3', 'E3', 'C3', 'G2', 'C3', 'E3',
               'A2', 'E3', 'A2', 'C3', 'G2', 'D3', 'G2', 'B2'], 0.35)),
    ],
    drums: [
      ...hits([0, 1.5, 2, 3.5, 4, 5.5, 6, 7.5,
               8, 9.5, 10, 11.5, 12, 13.5, 14, 15.5], 'kick', 0.9),
      ...hits([1, 3, 5, 7, 9, 11, 13, 15], 'snare', 0.7),
      ...every(0.5, 16, 'hat', 0.5),
    ],
  },

  // The fastest of the three: four-on-the-floor under a square-wave riff and a
  // bass on straight eighths. Unapologetically a chase.
  dog: {
    bpm: 150,
    beats: 16,
    parts: [
      // Square is harsh, so it runs at roughly half the triangle's volume.
      line({ type: 'square', vol: 0.05, attack: 0.004, release: 0.08 }, [
        { t: 0, note: 'C5', dur: 0.35 },     { t: 0.5, note: 'E5', dur: 0.35 },
        { t: 1, note: 'G5', dur: 0.35 },     { t: 1.5, note: 'C6', dur: 0.35 },
        { t: 2, note: 'B5', dur: 0.35 },     { t: 2.5, note: 'G5', dur: 0.35 },
        { t: 3, note: 'A5', dur: 0.35 },     { t: 3.5, note: 'B5', dur: 0.35 },
        { t: 4, note: 'C6', dur: 0.35 },     { t: 4.5, note: 'A5', dur: 0.35 },
        { t: 5, note: 'F5', dur: 0.35 },     { t: 5.5, note: 'A5', dur: 0.35 },
        { t: 6, note: 'C6', dur: 0.7 },      { t: 7, note: 'A5', dur: 0.35 },
        { t: 7.5, note: 'G5', dur: 0.35 },
        { t: 8, note: 'E5', dur: 0.35 },     { t: 8.5, note: 'G5', dur: 0.35 },
        { t: 9, note: 'C6', dur: 0.35 },     { t: 9.5, note: 'B5', dur: 0.35 },
        { t: 10, note: 'A5', dur: 0.35 },    { t: 10.5, note: 'G5', dur: 0.35 },
        { t: 11, note: 'E5', dur: 0.7 },
        { t: 12, note: 'D5', dur: 0.35 },    { t: 12.5, note: 'F5', dur: 0.35 },
        { t: 13, note: 'A5', dur: 0.35 },    { t: 13.5, note: 'G5', dur: 0.35 },
        { t: 14, note: 'E5', dur: 0.35 },    { t: 14.5, note: 'D5', dur: 0.35 },
        { t: 15, note: 'C5', dur: 0.9 },
      ]),
      line({ type: 'triangle', vol: 0.085, attack: 0.004, release: 0.07 },
        pulse(['C3', 'C3', 'G2', 'G2', 'C3', 'C3', 'E3', 'E3',
               'F2', 'F2', 'C3', 'C3', 'F2', 'F2', 'A2', 'A2',
               'C3', 'C3', 'G2', 'G2', 'C3', 'C3', 'E3', 'E3',
               'G2', 'G2', 'D3', 'D3', 'G2', 'G2', 'B2', 'B2'], 0.3, 0.5)),
    ],
    drums: [
      ...every(1, 16, 'kick'),                             // four on the floor
      ...hits([1, 3, 5, 7, 9, 11, 13, 15], 'snare', 0.85),
      ...every(0.5, 16, 'hat', 0.5),
      ...hits([7.5, 15.5], 'hatOpen', 0.75),
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

// One shared half-second of white noise, reused by every hat and snare — the
// buffer is the expensive part, the filter shapes it into a different drum.
let noise: AudioBuffer | null = null;
function noiseBuffer(c: AudioContext): AudioBuffer {
  if (!noise || noise.sampleRate !== c.sampleRate) {
    noise = c.createBuffer(1, Math.floor(c.sampleRate * 0.5), c.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  return noise;
}

function playDrum(c: AudioContext, bus: GainNode, kind: DrumKind, at: number, vol: number) {
  const gain = c.createGain();
  gain.connect(bus);

  if (kind === 'kick') {
    // Pitch drop is the whole trick: 140Hz → 45Hz in a tenth of a second reads
    // as a beater hitting a skin, where a fixed low sine is just a hum.
    const osc = c.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(140, at);
    osc.frequency.exponentialRampToValueAtTime(45, at + 0.11);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.34 * vol, at + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.22);
    osc.connect(gain);
    osc.start(at);
    osc.stop(at + 0.24);
    return;
  }

  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c);
  const filter = c.createBiquadFilter();
  const isSnare = kind === 'snare';
  const dur = isSnare ? 0.13 : kind === 'hatOpen' ? 0.18 : 0.04;
  filter.type = isSnare ? 'bandpass' : 'highpass';
  filter.frequency.value = isSnare ? 1900 : 7200;
  if (isSnare) filter.Q.value = 0.8;
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime((isSnare ? 0.16 : 0.085) * vol, at + 0.004);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  src.connect(filter);
  filter.connect(gain);
  src.start(at);
  src.stop(at + dur + 0.02);
}

/** Schedules the loop bar-by-bar and returns a stop fn. */
function startSynth(track: Track): () => void {
  const c = actx();
  const bus = musicBus();
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
    for (const h of track.drums ?? []) {
      playDrum(c, trackGain, h.kind, nextStart + h.t * beat, h.vol ?? 1);
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
const trims = new Map<TrackId, GainNode>();

/**
 * Per-file level trim, applied only to drop-in .mp3s (the synth themes are
 * written to a level and don't need it). Two arbitrary tracks are never
 * mastered to the same loudness, and there's no way to normalise them at
 * build time from here — so this is the knob. 1 = as recorded.
 *
 * THIS IS THE ONE PLACE TO ADJUST if a track sits wrong against the effects.
 * Above ~2 a already-hot file will clip; if a track needs that much, it's
 * better to turn the others down than to push that one up.
 */
const FILE_GAIN: Record<TrackId, number> = {
  cat: 1,
  dog: 1.7,   // supplied file is noticeably quieter than the cat's
};

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
  const bus = musicBus();
  if (!c || !bus) return () => {};

  let el = elements.get(id);
  if (!el) {
    el = new Audio(FILES[id]);
    el.loop = true;
    el.preload = 'auto';
    elements.set(id, el);
    // createMediaElementSource throws if called twice for one element, so the
    // element is cached and wired exactly once — source → per-file trim → bus.
    const trim = c.createGain();
    trim.gain.value = FILE_GAIN[id];
    trims.set(id, trim);          // hard reference, so the node can't be collected
    c.createMediaElementSource(el).connect(trim);
    trim.connect(bus);
  }
  el.currentTime = 0;
  void el.play().catch(() => {/* gesture not registered yet; mute toggle recovers */});

  const stopEl = el;
  return () => stopEl.pause();
}

// ─── Public API ───────────────────────────────────────────────────────────
let currentId: TrackId | null = null;
let stopCurrent: (() => void) | null = null;
// Bumped by every start and every stop. Starting a track is asynchronous
// (gesture unlock, then a HEAD probe), so several starts can be in flight at
// once — tapping back and forth on avatar-select does exactly that. Comparing
// ids isn't enough: two in-flight starts for the SAME id both pass an id check,
// and the second overwrites `stopCurrent`, orphaning the first (a layered synth
// loop that nothing can stop, or an element nobody pauses). A token is unique
// per call, so only the newest start survives.
let startToken = 0;

/** Start (or switch to) a track. No-op if it's already the one playing. */
export function playMusic(id: TrackId) {
  if (currentId === id) return;
  stopMusic();
  currentId = id;
  const token = ++startToken;

  whenUnlocked(() => {
    if (token !== startToken) return;       // switched again while waiting for a gesture
    void hasFile(id).then(exists => {
      if (token !== startToken) return;     // ...or while probing for the file
      stopCurrent = exists ? startFile(id) : startSynth(TRACKS[id]);
    });
  });
}

export function stopMusic() {
  startToken++;              // invalidates every start still in flight
  stopCurrent?.();
  stopCurrent = null;
  currentId = null;
  // Belt and braces: `stopCurrent` only ever holds the LAST stopper handed to
  // us, so if anything did slip through it would keep playing unheard-of.
  // Pausing every cached element makes "nothing is playing" true by
  // construction, and pausing an already-paused element is a no-op.
  elements.forEach(el => el.pause());
}

export function currentTrack(): TrackId | null {
  return currentId;
}
