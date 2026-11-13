import { downsampleInto, encodeWav, MAX_SECONDS, rmsOf, SpeechGate, VOICE_RATE } from './voice-activity.ts';

export type CaptureResult =
  | { kind: 'audio'; wav: Blob }
  /** The microphone worked but nobody spoke. */
  | { kind: 'nothing' }
  /** The learner or the browser refused the microphone. */
  | { kind: 'denied' }
  /** This browser has no microphone API, or it failed to start. */
  | { kind: 'unavailable' };

/**
 * Records one spoken question from the microphone and ends by itself when the speaker stops
 * (voice-activity.ts). The microphone is opened for the question and released straight after.
 *
 * Not verified on a headset: whether Quest Browser grants the microphone inside an immersive
 * session, and how its prompt behaves there, is unknown. `prime()` asks on the 2D page instead.
 */
export class VoiceCapture {
  /** Smoothed loudness of what is being heard, 0–1, for the icon to pulse with. */
  level = 0;
  private finish: ((send: boolean) => void) | null = null;

  static get supported(): boolean {
    return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof AudioContext !== 'undefined';
  }

  get active(): boolean {
    return this.finish !== null;
  }

  /** Ask for the microphone now and release it, so the prompt appears on the 2D page. */
  static async prime(): Promise<boolean> {
    if (!VoiceCapture.supported) return false;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      return true;
    } catch {
      return false;
    }
  }

  /** Stop listening now and send what was said so far. */
  stop(): void {
    this.finish?.(true);
  }

  /** Stop listening and throw the recording away. */
  cancel(): void {
    this.finish?.(false);
  }

  /** Listen for one question. Resolves when the speaker stops, `stop()` or `cancel()` is called, or time runs out. */
  async listen(): Promise<CaptureResult> {
    if (this.finish) return { kind: 'nothing' };
    if (!VoiceCapture.supported) return { kind: 'unavailable' };
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    } catch (err) {
      const name = (err as { name?: string } | null)?.name;
      return { kind: name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'unavailable' };
    }
    let ctx: AudioContext;
    try {
      ctx = new AudioContext();
    } catch {
      stream.getTracks().forEach((t) => t.stop());
      return { kind: 'unavailable' };
    }
    const samples = new Int16Array(VOICE_RATE * MAX_SECONDS);
    let count = 0;
    const gate = new SpeechGate();
    const source = ctx.createMediaStreamSource(stream);
    // A ScriptProcessor is deprecated but is in every Chromium, and needs no separate worklet file.
    const tap = ctx.createScriptProcessor(4096, 1, 1);
    return new Promise<CaptureResult>((resolve) => {
      this.finish = (send) => {
        this.finish = null;
        this.level = 0;
        tap.onaudioprocess = null;
        source.disconnect();
        tap.disconnect();
        stream.getTracks().forEach((t) => t.stop());
        void ctx.close().catch(() => undefined);
        resolve(send && gate.heard && count > 0 ? { kind: 'audio', wav: new Blob([encodeWav(samples, count)], { type: 'audio/wav' }) } : { kind: 'nothing' });
      };
      tap.onaudioprocess = (e) => {
        const block = e.inputBuffer.getChannelData(0);
        const rms = rmsOf(block);
        this.level += (Math.min(1, rms * 8) - this.level) * 0.5;
        count += downsampleInto(block, ctx.sampleRate, samples, count);
        const state = gate.feed(rms, block.length / ctx.sampleRate);
        if (state !== 'listening') this.finish?.(state !== 'nothing');
      };
      source.connect(tap);
      tap.connect(ctx.destination); // it only runs while connected; it writes silence
      void ctx.resume().catch(() => undefined);
    });
  }
}
