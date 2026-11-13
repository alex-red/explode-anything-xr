/**
 * The pure half of voice capture: when someone has finished speaking, and how the recording is
 * packed. No DOM and no audio API here, so all of it is tested headless.
 */

/** What speech-to-text is sent: 16 kHz mono, 16-bit. */
export const VOICE_RATE = 16_000;
/** Longest question recorded, s. */
export const MAX_SECONDS = 10;
/** Give up when nothing has been said after this long, s. */
export const NOTHING_AFTER = 5;
/** Quiet after speech that ends the question, s. */
export const END_QUIET = 1.1;
/** Speech shorter than this is a click or a cough, s. */
const MIN_SPEECH = 0.15;
/** Never treat anything quieter than this as speech, whatever the room. */
const FLOOR = 0.012;

export type GateState = 'listening' | 'done' | 'nothing' | 'full';

/**
 * Decides when a spoken question has ended, from the loudness of each audio block. The room's
 * own noise is learned from the quietest blocks, and speech is anything well above it.
 */
export class SpeechGate {
  private elapsed = 0;
  private spoken = 0;
  private quiet = 0;
  private noise = Infinity;

  /** True once enough speech has been heard to be worth sending. */
  get heard(): boolean {
    return this.spoken >= MIN_SPEECH;
  }

  /** Feed one block: its loudness (RMS, 0–1) and length in seconds. */
  feed(rms: number, dt: number): GateState {
    this.elapsed += dt;
    // The quietest block so far, rising slowly so one silent block does not pin it forever, and
    // slowly enough that ten seconds of unbroken speech never becomes the floor.
    this.noise = Math.min(rms, this.noise === Infinity ? rms : this.noise * (1 + dt * 0.1));
    const speaking = rms > Math.max(FLOOR, this.noise * 3);
    if (speaking) {
      this.spoken += dt;
      this.quiet = 0;
    } else this.quiet += dt;
    if (this.heard && this.quiet >= END_QUIET) return 'done';
    if (!this.heard && this.elapsed >= NOTHING_AFTER) return 'nothing';
    if (this.elapsed >= MAX_SECONDS) return 'full';
    return 'listening';
  }
}

/** Loudness of a block of samples in −1…1. */
export function rmsOf(samples: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i]! * samples[i]!;
  return samples.length ? Math.sqrt(sum / samples.length) : 0;
}

/**
 * Resample a block from `fromRate` down to 16 kHz by averaging, writing 16-bit samples into
 * `out` from `offset`. Returns how many were written (it stops when `out` is full).
 */
export function downsampleInto(input: Float32Array, fromRate: number, out: Int16Array, offset: number): number {
  const ratio = fromRate / VOICE_RATE;
  const count = Math.min(Math.floor(input.length / ratio), out.length - offset);
  for (let i = 0; i < count; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.max(start + 1, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j++) sum += input[j]!;
    const v = Math.max(-1, Math.min(1, sum / (end - start)));
    out[offset + i] = Math.round(v * 32767);
  }
  return Math.max(0, count);
}

/** The first `count` samples as a WAV file (16-bit mono PCM at 16 kHz). */
export function encodeWav(samples: Int16Array, count: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(44 + count * 2);
  const view = new DataView(bytes.buffer);
  const tag = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) bytes[at + i] = s.charCodeAt(i);
  };
  tag(0, 'RIFF');
  view.setUint32(4, 36 + count * 2, true);
  tag(8, 'WAVE');
  tag(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, VOICE_RATE, true);
  view.setUint32(28, VOICE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  tag(36, 'data');
  view.setUint32(40, count * 2, true);
  for (let i = 0; i < count; i++) view.setInt16(44 + i * 2, samples[i]!, true);
  return bytes;
}
