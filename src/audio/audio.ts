export type SoundName = 'gatling' | 'cannon' | 'frost' | 'tesla' | 'rail' | 'explosion' | 'kill' | 'leak' | 'wave' | 'clear' | 'place' | 'upgrade' | 'sell' | 'error' | 'win' | 'lose';

interface Tone {
  wave: OscillatorType | 'noise';
  from: number;
  to: number;
  duration: number;
  gain: number;
  delay?: number;
}

const SOUNDS: Record<SoundName, Tone[]> = {
  gatling: [{ wave: 'square', from: 520, to: 180, duration: 0.04, gain: 0.05 }],
  cannon: [{ wave: 'triangle', from: 160, to: 50, duration: 0.16, gain: 0.3 }],
  frost: [{ wave: 'sine', from: 1200, to: 1700, duration: 0.09, gain: 0.05 }],
  tesla: [{ wave: 'sawtooth', from: 1500, to: 300, duration: 0.09, gain: 0.08 }],
  rail: [{ wave: 'sawtooth', from: 2200, to: 120, duration: 0.22, gain: 0.16 }],
  explosion: [{ wave: 'noise', from: 900, to: 120, duration: 0.22, gain: 0.3 }],
  kill: [{ wave: 'triangle', from: 420, to: 120, duration: 0.07, gain: 0.07 }],
  leak: [{ wave: 'square', from: 180, to: 70, duration: 0.3, gain: 0.25 }],
  wave: [
    { wave: 'triangle', from: 220, to: 220, duration: 0.16, gain: 0.25 },
    { wave: 'triangle', from: 330, to: 330, duration: 0.24, gain: 0.25, delay: 0.14 },
  ],
  clear: [
    { wave: 'sine', from: 523, to: 523, duration: 0.12, gain: 0.2 },
    { wave: 'sine', from: 784, to: 784, duration: 0.22, gain: 0.2, delay: 0.1 },
  ],
  place: [{ wave: 'triangle', from: 240, to: 480, duration: 0.09, gain: 0.25 }],
  upgrade: [
    { wave: 'triangle', from: 400, to: 800, duration: 0.12, gain: 0.25 },
    { wave: 'triangle', from: 800, to: 1200, duration: 0.12, gain: 0.2, delay: 0.09 },
  ],
  sell: [{ wave: 'triangle', from: 700, to: 300, duration: 0.14, gain: 0.22 }],
  error: [{ wave: 'square', from: 130, to: 110, duration: 0.12, gain: 0.14 }],
  win: [523, 659, 784, 1047].map((f, i) => ({ wave: 'triangle' as const, from: f, to: f, duration: 0.32, gain: 0.25, delay: i * 0.16 })),
  lose: [392, 330, 262, 196].map((f, i) => ({ wave: 'sawtooth' as const, from: f, to: f * 0.96, duration: 0.36, gain: 0.14, delay: i * 0.2 })),
};

const MIN_REPEAT_SECONDS = 0.07;
const MAX_VOICES = 14;

/** Synthesized effects with per-sound rate limiting and a global voice cap. */
export class AudioEngine {
  muted = false;
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private voices = 0;
  private readonly lastPlayed = new Map<SoundName, number>();

  /** Browsers only allow audio to start from a user gesture. */
  unlock(): void {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.5;
      this.master.connect(this.ctx.destination);
      const length = Math.floor(this.ctx.sampleRate * 0.4);
      this.noise = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master) this.master.gain.value = muted ? 0 : 0.5;
  }

  play(name: SoundName): void {
    const { ctx, master } = this;
    if (!ctx || !master || this.muted || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    if (now - (this.lastPlayed.get(name) ?? -1) < MIN_REPEAT_SECONDS || this.voices >= MAX_VOICES) return;
    this.lastPlayed.set(name, now);
    for (const tone of SOUNDS[name]) this.schedule(ctx, master, tone, now + (tone.delay ?? 0));
  }

  private schedule(ctx: AudioContext, master: GainNode, tone: Tone, start: number): void {
    const end = start + tone.duration;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(tone.gain, start);
    gain.gain.exponentialRampToValueAtTime(0.0008, end);
    let source: AudioScheduledSourceNode;
    if (tone.wave === 'noise') {
      const buffer = ctx.createBufferSource();
      buffer.buffer = this.noise;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(tone.from, start);
      filter.frequency.exponentialRampToValueAtTime(tone.to, end);
      buffer.connect(filter).connect(gain);
      source = buffer;
    } else {
      const osc = ctx.createOscillator();
      osc.type = tone.wave;
      osc.frequency.setValueAtTime(tone.from, start);
      osc.frequency.exponentialRampToValueAtTime(tone.to, end);
      osc.connect(gain);
      source = osc;
    }
    gain.connect(master);
    this.voices++;
    source.onended = () => {
      this.voices--;
      gain.disconnect();
    };
    source.start(start);
    source.stop(end + 0.02);
  }
}
