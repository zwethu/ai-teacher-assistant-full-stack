// Audio Synthesizer using Web Audio API
class CatAudioEngine {
  private ctx: AudioContext | null = null;
  private bgmInterval: number | any = null;
  private isMuted: boolean = false;

  init() {
    if (this.ctx) return;
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (AudioContextClass) this.ctx = new AudioContextClass();
  }

  setMute(muted: boolean) {
    this.isMuted = muted;
    if (muted) this.stopBGM();
    else this.startBGM();
  }

  getMuted() { return this.isMuted; }

  private createGain(duration: number, startVal = 1) {
    if (!this.ctx) return null;
    const gain = this.ctx.createGain();
    const now = this.ctx.currentTime;
    gain.gain.setValueAtTime(startVal, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    return gain;
  }

  playTap() {
    if (this.isMuted) return;
    this.init(); if (!this.ctx) return;
    if (this.ctx.state === 'suspended') this.ctx.resume();
    const osc = this.ctx.createOscillator();
    const gain = this.createGain(0.12, 0.15); if (!gain) return;
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(440, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(150, this.ctx.currentTime + 0.12);
    osc.connect(gain); gain.connect(this.ctx.destination);
    osc.start(); osc.stop(this.ctx.currentTime + 0.12);
  }

  playFlip() {
    if (this.isMuted) return;
    this.init(); if (!this.ctx) return;
    if (this.ctx.state === 'suspended') this.ctx.resume();
    const osc = this.ctx.createOscillator();
    const gain = this.createGain(0.1, 0.1); if (!gain) return;
    osc.type = 'sine';
    osc.frequency.setValueAtTime(600, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(900, this.ctx.currentTime + 0.1);
    osc.connect(gain); gain.connect(this.ctx.destination);
    osc.start(); osc.stop(this.ctx.currentTime + 0.1);
  }

  playPurr() {
    if (this.isMuted) return;
    this.init(); if (!this.ctx) return;
    if (this.ctx.state === 'suspended') this.ctx.resume();
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const lfo = this.ctx.createOscillator();
    const lfoGain = this.ctx.createGain();
    const volumeGain = this.ctx.createGain();
    osc.type = 'sawtooth'; osc.frequency.setValueAtTime(45, now);
    lfo.type = 'sine'; lfo.frequency.setValueAtTime(9, now);
    lfoGain.gain.setValueAtTime(15, now);
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass'; filter.frequency.setValueAtTime(90, now);
    volumeGain.gain.setValueAtTime(0, now);
    volumeGain.gain.linearRampToValueAtTime(0.3, now + 0.1);
    volumeGain.gain.setValueAtTime(0.3, now + 0.8);
    volumeGain.gain.exponentialRampToValueAtTime(0.001, now + 1.2);
    lfo.connect(lfoGain); lfoGain.connect(osc.frequency);
    osc.connect(filter); filter.connect(volumeGain); volumeGain.connect(this.ctx.destination);
    lfo.start(now); osc.start(now); lfo.stop(now + 1.2); osc.stop(now + 1.2);
  }

  playMeow() {
    if (this.isMuted) return;
    this.init(); if (!this.ctx) return;
    if (this.ctx.state === 'suspended') this.ctx.resume();
    const now = this.ctx.currentTime;
    const osc1 = this.ctx.createOscillator();
    const osc2 = this.ctx.createOscillator();
    const gainNode = this.ctx.createGain();
    osc1.type = 'triangle'; osc2.type = 'sine';
    osc1.frequency.setValueAtTime(580, now); osc1.frequency.exponentialRampToValueAtTime(1100, now + 0.12); osc1.frequency.exponentialRampToValueAtTime(750, now + 0.35);
    osc2.frequency.setValueAtTime(580, now); osc2.frequency.exponentialRampToValueAtTime(1100, now + 0.12); osc2.frequency.exponentialRampToValueAtTime(750, now + 0.35);
    gainNode.gain.setValueAtTime(0.01, now); gainNode.gain.linearRampToValueAtTime(0.25, now + 0.08); gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
    const filter = this.ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.setValueAtTime(1600, now);
    osc1.connect(filter); osc2.connect(filter); filter.connect(gainNode); gainNode.connect(this.ctx.destination);
    osc1.start(now); osc2.start(now); osc1.stop(now + 0.4); osc2.stop(now + 0.4);
  }

  playCorrectChime() {
    if (this.isMuted) return;
    this.init(); if (!this.ctx) return;
    if (this.ctx.state === 'suspended') this.ctx.resume();
    this.playMeow();
    const now = this.ctx.currentTime;
    const notes = [523.25, 659.25, 783.99, 1046.50];
    notes.forEach((freq, idx) => {
      const startTime = now + idx * 0.08;
      const osc = this.ctx!.createOscillator();
      const gain = this.ctx!.createGain();
      osc.type = 'sine'; osc.frequency.setValueAtTime(freq, startTime);
      gain.gain.setValueAtTime(0.001, startTime); gain.gain.linearRampToValueAtTime(0.12, startTime + 0.02); gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.4);
      osc.connect(gain); gain.connect(this.ctx!.destination);
      osc.start(startTime); osc.stop(startTime + 0.4);
    });
  }

  playOops() {
    if (this.isMuted) return;
    this.init(); if (!this.ctx) return;
    if (this.ctx.state === 'suspended') this.ctx.resume();
    const now = this.ctx.currentTime;
    const notes = [293.66, 220.00];
    notes.forEach((freq, idx) => {
      const startTime = now + idx * 0.15;
      const osc = this.ctx!.createOscillator();
      const gain = this.ctx!.createGain();
      osc.type = 'triangle'; osc.frequency.setValueAtTime(freq, startTime); osc.frequency.linearRampToValueAtTime(freq - 30, startTime + 0.25);
      gain.gain.setValueAtTime(0.001, startTime); gain.gain.linearRampToValueAtTime(0.15, startTime + 0.03); gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.28);
      osc.connect(gain); gain.connect(this.ctx!.destination);
      osc.start(startTime); osc.stop(startTime + 0.3);
    });
  }

  startBGM() {
    if (this.isMuted) return;
    this.init(); if (!this.ctx) return;
    if (this.ctx.state === 'suspended') return;
    if (this.bgmInterval) return;
    const chords = [
      [261.63, 329.63, 392.00, 523.25],
      [349.23, 440.00, 523.25, 698.46],
      [293.66, 349.23, 440.00, 587.33],
      [392.00, 493.88, 587.33, 783.99]
    ];
    let chordIndex = 0;
    const playNextChord = () => {
      if (!this.ctx || this.isMuted) return;
      const now = this.ctx.currentTime;
      const currentChord = chords[chordIndex % chords.length];
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass'; filter.frequency.setValueAtTime(450, now);
      currentChord.forEach((freq, index) => {
        const osc = this.ctx!.createOscillator();
        const gain = this.ctx!.createGain();
        const delay = index * 0.05;
        const noteStart = now + delay;
        osc.type = 'triangle'; osc.frequency.setValueAtTime(freq, noteStart);
        gain.gain.setValueAtTime(0, noteStart); gain.gain.linearRampToValueAtTime(0.04, noteStart + 0.1); gain.gain.exponentialRampToValueAtTime(0.001, noteStart + 2.8);
        osc.connect(filter); filter.connect(gain); gain.connect(this.ctx!.destination);
        osc.start(noteStart); osc.stop(noteStart + 3.0);
      });
      const bassFreq = currentChord[0] / 2;
      const bassOsc = this.ctx.createOscillator();
      const bassGain = this.ctx.createGain();
      bassOsc.type = 'sine'; bassOsc.frequency.setValueAtTime(bassFreq, now);
      bassGain.gain.setValueAtTime(0, now); bassGain.gain.linearRampToValueAtTime(0.06, now + 0.15); bassGain.gain.exponentialRampToValueAtTime(0.001, now + 2.8);
      bassOsc.connect(filter); filter.connect(bassGain); bassGain.connect(this.ctx!.destination);
      bassOsc.start(now); bassOsc.stop(now + 3.0);
      chordIndex++;
    };
    playNextChord();
    this.bgmInterval = setInterval(playNextChord, 3200);
  }

  stopBGM() {
    if (this.bgmInterval) { clearInterval(this.bgmInterval); this.bgmInterval = null; }
  }
}

export const catAudio = new CatAudioEngine();
export default catAudio;
