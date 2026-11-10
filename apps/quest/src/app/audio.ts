/** Tiny synthesized SFX (no audio assets to license). Audio is always redundant with visuals. */
export class Sfx {
  private ctx: AudioContext | null = null;
  private muted = false;

  private ensure(): AudioContext | null {
    if (this.muted) return null;
    try {
      this.ctx ??= new AudioContext();
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return this.ctx;
    } catch {
      return null;
    }
  }

  suspend(): void {
    void this.ctx?.suspend().catch(() => undefined);
  }

  private tone(freq: number, dur: number, type: OscillatorType = 'sine', gain = 0.06, endFreq?: number): void {
    const ctx = this.ensure();
    if (!ctx) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (endFreq) osc.frequency.exponentialRampToValueAtTime(endFreq, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  click(): void {
    this.tone(880, 0.06, 'triangle', 0.04);
  }
  explode(): void {
    this.tone(220, 0.35, 'sine', 0.07, 520);
  }
  collapse(): void {
    this.tone(520, 0.3, 'sine', 0.06, 200);
  }
  unplug(): void {
    this.tone(300, 0.25, 'sawtooth', 0.035, 110);
  }
  plug(): void {
    this.tone(660, 0.08, 'triangle', 0.05);
    setTimeout(() => this.tone(990, 0.12, 'triangle', 0.05), 80);
  }
  reject(): void {
    this.tone(180, 0.18, 'square', 0.03);
  }
  step(): void {
    this.tone(740, 0.1, 'sine', 0.04, 880);
  }
}
