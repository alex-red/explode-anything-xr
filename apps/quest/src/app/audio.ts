/**
 * Sound design (docs/WIN_PLAN.md W5): one coherent, fully synthesized set (no audio assets to
 * license), placed in space at the part it belongs to. Every sound is redundant with something
 * visible, so the app is complete with sound off.
 *
 * Everything runs through master gain → compressor → speakers. The listener follows the head
 * each frame without allocating; a sound allocates its few nodes when it plays (on events,
 * never per frame).
 *
 * Browsers refuse to start audio before a user gesture and log a warning if asked. Sounds that
 * answer a press may start the audio context; ambient ones (boot, hum, room dimming) only play
 * once it is running.
 */

/** A world position, or null for a sound that has no place (it plays centred). */
export interface At {
  x: number;
  y: number;
  z: number;
}

export type SoundLevel = 'on' | 'quiet' | 'off';
const LEVELS: SoundLevel[] = ['on', 'quiet', 'off'];
const LEVEL_GAIN: Record<SoundLevel, number> = { on: 0.9, quiet: 0.35, off: 0 };
const STORAGE_KEY = 'explode:sound:v1';

/** Pitches (Hz) of the set's scale, so the chimes agree with each other. */
const NOTE = { C5: 523.25, E5: 659.25, G5: 783.99, B5: 987.77, C6: 1046.5, E6: 1318.5 } as const;

interface CameraLike {
  matrixWorld: { elements: ArrayLike<number> };
}

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private humOn = false;
  level: SoundLevel = readLevel();
  /** The last sounds played, newest last (tests and the debug log). */
  readonly played: string[] = [];

  /** Next level in on → quiet → off, remembered between visits. */
  cycleLevel(): SoundLevel {
    this.setLevel(LEVELS[(LEVELS.indexOf(this.level) + 1) % LEVELS.length]!);
    return this.level;
  }

  setLevel(level: SoundLevel): void {
    this.level = level;
    writeLevel(level);
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(LEVEL_GAIN[level], this.ctx.currentTime, 0.03);
    if (level === 'off') this.hum(false);
  }

  suspend(): void {
    void this.ctx?.suspend().catch(() => undefined);
  }

  /** Move the listener to the head. Call every frame; no allocation. */
  updateListener(camera: CameraLike): void {
    const l = this.ctx?.listener;
    if (!l) return;
    const e = camera.matrixWorld.elements;
    // Columns of the camera's world matrix: x axis 0–2, y (up) 4–6, z (back) 8–10, position 12–14.
    if (l.positionX) {
      l.positionX.value = e[12]!;
      l.positionY.value = e[13]!;
      l.positionZ.value = e[14]!;
      l.forwardX.value = -e[8]!;
      l.forwardY.value = -e[9]!;
      l.forwardZ.value = -e[10]!;
      l.upX.value = e[4]!;
      l.upY.value = e[5]!;
      l.upZ.value = e[6]!;
    } else {
      l.setPosition?.(e[12]!, e[13]!, e[14]!);
      l.setOrientation?.(-e[8]!, -e[9]!, -e[10]!, e[4]!, e[5]!, e[6]!);
    }
  }

  // ------------------------------------------------------------ the set

  /** A button or part was pressed. */
  click(at: At | null = null): void {
    const c = this.start('click', true);
    if (!c) return;
    this.tone(c, at, 0, 1400, 0.045, 'triangle', 0.035, 1100);
  }

  /** The lesson moved on: a soft two-note rise. */
  step(): void {
    const c = this.start('step', true);
    if (!c) return;
    this.tone(c, null, 0, NOTE.E5, 0.16, 'sine', 0.035);
    this.tone(c, null, 0.09, NOTE.B5, 0.22, 'sine', 0.03);
  }

  /** A model materialises on the stage: a rising shimmer and a low swell. */
  boot(at: At | null): void {
    const c = this.start('boot', false);
    if (!c) return;
    this.whoosh(c, at, 0, 1.2, 300, 3200, 0.05);
    this.tone(c, at, 0, 110, 1.3, 'sine', 0.05, 220);
  }

  explode(at: At | null): void {
    const c = this.start('explode', true);
    if (!c) return;
    this.whoosh(c, at, 0, 0.45, 400, 2600, 0.06);
    this.tone(c, at, 0, 220, 0.4, 'sine', 0.05, 440);
  }

  collapse(at: At | null): void {
    const c = this.start('collapse', true);
    if (!c) return;
    this.whoosh(c, at, 0, 0.4, 2600, 400, 0.05);
    this.tone(c, at, 0, 440, 0.35, 'sine', 0.045, 220);
  }

  /** A link is pulled out: a dry pop and a falling buzz. */
  unplug(at: At | null): void {
    const c = this.start('unplug', true);
    if (!c) return;
    this.burst(c, at, 0, 0.05, 1800, 0.08);
    this.tone(c, at, 0.02, 300, 0.28, 'sawtooth', 0.03, 90);
  }

  /** The failure spreads: one falling blip at each affected part, in path order. */
  cascade(points: readonly At[]): void {
    const c = this.start('cascade', false);
    if (!c) return;
    points.forEach((p, i) => this.tone(c, p, 0.08 + i * 0.13, 700 * Math.pow(0.84, i), 0.16, 'sine', 0.045, 520 * Math.pow(0.84, i)));
  }

  /** A socket that does not take this link: two short low buzzes. */
  reject(at: At | null): void {
    const c = this.start('reject', true);
    if (!c) return;
    this.tone(c, at, 0, 150, 0.08, 'square', 0.025);
    this.tone(c, at, 0.12, 140, 0.1, 'square', 0.025);
  }

  /** The link clicks home and the flow returns: a click and a rising major arpeggio. */
  repair(at: At | null): void {
    const c = this.start('repair', true);
    if (!c) return;
    this.burst(c, at, 0, 0.03, 3000, 0.07);
    this.tone(c, at, 0.04, NOTE.C5, 0.2, 'triangle', 0.045);
    this.tone(c, at, 0.12, NOTE.E5, 0.2, 'triangle', 0.045);
    this.tone(c, at, 0.2, NOTE.G5, 0.35, 'triangle', 0.045);
  }

  /** A lesson is finished: a short bell phrase. */
  complete(): void {
    const c = this.start('complete', true);
    if (!c) return;
    [NOTE.C5, NOTE.E5, NOTE.G5, NOTE.C6].forEach((f, i) => this.tone(c, null, i * 0.11, f, 0.6, 'sine', 0.04));
    this.tone(c, null, 0.44, NOTE.E6, 0.9, 'sine', 0.02);
  }

  /** The real room dims (true) or comes back (false). */
  dim(on: boolean): void {
    const c = this.start(on ? 'dim' : 'undim', false);
    if (!c) return;
    if (on) {
      this.whoosh(c, null, 0, 0.8, 1800, 250, 0.04);
      this.tone(c, null, 0, 330, 0.8, 'sine', 0.035, 165);
    } else {
      this.whoosh(c, null, 0, 0.7, 250, 1800, 0.04);
      this.tone(c, null, 0, 165, 0.7, 'sine', 0.035, 330);
    }
  }

  /**
   * The quiet hum of a traced, intact flow, placed at the model. Cutting a link silences it,
   * which is the point. Ambient: it never starts the audio context itself.
   */
  hum(on: boolean, at: At | null = null): void {
    if (on === this.humOn) return;
    this.humOn = on;
    if (!on) {
      // Fade out, then stop each oscillator at a scheduled time: no timers involved.
      const c = this.ctx;
      if (c && this.humGain) {
        const t = c.currentTime;
        this.humGain.gain.setTargetAtTime(0, t, 0.08);
        for (const o of this.humOscs) o.stop(t + 0.6);
      }
      this.humOscs = [];
      this.humGain = null;
      return;
    }
    const c = this.start('hum', false);
    if (!c) return;
    const t = c.currentTime;
    const gain = c.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.setTargetAtTime(0.022, t, 0.25);
    this.route(c, gain, at);
    for (const [freq, detune] of [
      [110, 0],
      [165, 4],
    ] as const) {
      const osc = c.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;
      osc.detune.value = detune;
      osc.connect(gain);
      osc.start(t);
      this.humOscs.push(osc);
    }
    // A slow swell keeps it alive without drawing attention.
    const lfo = c.createOscillator();
    const depth = c.createGain();
    lfo.frequency.value = 0.4;
    depth.gain.value = 0.008;
    lfo.connect(depth).connect(gain.gain);
    lfo.start(t);
    this.humOscs.push(lfo);
    this.humGain = gain;
  }

  private humOscs: OscillatorNode[] = [];
  private humGain: GainNode | null = null;

  // ------------------------------------------------------------ building blocks

  /**
   * The context to play `name` on, or null when sound is off or cannot play. Only a sound that
   * answers a press (`fromGesture`) may create or resume the context.
   */
  private start(name: string, fromGesture: boolean): AudioContext | null {
    if (this.level === 'off') return null;
    if (!this.ctx) {
      if (!fromGesture) return null;
      try {
        const Ctor = (globalThis as { AudioContext?: typeof AudioContext }).AudioContext;
        if (!Ctor) return null;
        this.ctx = new Ctor();
        const comp = this.ctx.createDynamicsCompressor();
        comp.threshold.value = -18;
        comp.ratio.value = 4;
        this.master = this.ctx.createGain();
        this.master.gain.value = LEVEL_GAIN[this.level];
        this.master.connect(comp).connect(this.ctx.destination);
      } catch {
        this.ctx = null;
        return null;
      }
    }
    if (this.ctx.state === 'suspended') {
      if (!fromGesture) return null;
      void this.ctx.resume().catch(() => undefined);
    }
    this.played.push(name);
    if (this.played.length > 32) this.played.shift();
    return this.ctx;
  }

  /** Connect `node` to the master, through a panner at `at` when it has a place. */
  private route(c: AudioContext, node: AudioNode, at: At | null): PannerNode | null {
    if (!at) {
      node.connect(this.master!);
      return null;
    }
    const p = c.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = 0.4;
    p.rolloffFactor = 0.6;
    if (p.positionX) {
      p.positionX.value = at.x;
      p.positionY.value = at.y;
      p.positionZ.value = at.z;
    } else p.setPosition?.(at.x, at.y, at.z);
    node.connect(p).connect(this.master!);
    return p;
  }

  private tone(c: AudioContext, at: At | null, delay: number, freq: number, dur: number, type: OscillatorType, gain: number, endFreq?: number): void {
    const t = c.currentTime + delay;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (endFreq) osc.frequency.exponentialRampToValueAtTime(endFreq, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    this.route(c, g, at);
    osc.start(t);
    osc.stop(t + dur + 0.03);
  }

  /** Filtered noise swept from `from` to `to` Hz: air, whooshes, shimmer. */
  private whoosh(c: AudioContext, at: At | null, delay: number, dur: number, from: number, to: number, gain: number): void {
    const t = c.currentTime + delay;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuffer(c);
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 1.4;
    f.frequency.setValueAtTime(from, t);
    f.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + dur * 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g);
    this.route(c, g, at);
    src.start(t);
    src.stop(t + dur + 0.03);
  }

  /** A short noise burst through a low-pass: pops and clicks. */
  private burst(c: AudioContext, at: At | null, delay: number, dur: number, cutoff: number, gain: number): void {
    const t = c.currentTime + delay;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuffer(c);
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = cutoff;
    const g = c.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g);
    this.route(c, g, at);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  /** One second of white noise, made once and shared by every noise sound. */
  private noiseBuffer(c: AudioContext): AudioBuffer {
    if (!this.noise) {
      this.noise = c.createBuffer(1, c.sampleRate, c.sampleRate);
      const data = this.noise.getChannelData(0);
      let seed = 0x2545f491; // fixed seed: the same noise every run
      for (let i = 0; i < data.length; i++) {
        seed ^= seed << 13;
        seed ^= seed >>> 17;
        seed ^= seed << 5;
        data[i] = ((seed >>> 0) / 0xffffffff) * 2 - 1;
      }
    }
    return this.noise;
  }
}

function readLevel(): SoundLevel {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === 'quiet' || v === 'off' ? v : 'on';
  } catch {
    return 'on';
  }
}

function writeLevel(level: SoundLevel): void {
  try {
    localStorage.setItem(STORAGE_KEY, level);
  } catch {
    // Storage unavailable: the level holds for this visit only.
  }
}
