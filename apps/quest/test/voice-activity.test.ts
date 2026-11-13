import { describe, expect, it } from 'vitest';
import { downsampleInto, encodeWav, END_QUIET, MAX_SECONDS, NOTHING_AFTER, rmsOf, SpeechGate, VOICE_RATE } from '../src/app/voice-activity.ts';

const BLOCK = 4096 / 48_000;
/** Feed blocks of one loudness for `seconds`; returns the last state, stopping at the first that is not `listening`. */
function feed(gate: SpeechGate, rms: number, seconds: number) {
  let state = 'listening';
  for (let t = 0; t < seconds && state === 'listening'; t += BLOCK) state = gate.feed(rms, BLOCK);
  return state;
}

describe('SpeechGate', () => {
  it('ends a question a moment after the speaker stops', () => {
    const gate = new SpeechGate();
    expect(feed(gate, 0.004, 0.5)).toBe('listening'); // room noise
    expect(feed(gate, 0.12, 1.5)).toBe('listening'); // speech
    expect(gate.heard).toBe(true);
    expect(feed(gate, 0.004, END_QUIET - 0.3)).toBe('listening'); // a pause mid-sentence
    expect(feed(gate, 0.1, 0.4)).toBe('listening');
    expect(feed(gate, 0.004, END_QUIET + 0.2)).toBe('done');
  });

  it('gives up when nobody speaks, and never calls room noise speech', () => {
    const gate = new SpeechGate();
    expect(feed(gate, 0.006, NOTHING_AFTER + 0.5)).toBe('nothing');
    expect(gate.heard).toBe(false);
  });

  it('ignores a click, and a steady loud room', () => {
    const click = new SpeechGate();
    feed(click, 0.004, 0.3);
    click.feed(0.5, BLOCK);
    expect(click.heard).toBe(false);
    const fan = new SpeechGate();
    expect(feed(fan, 0.05, NOTHING_AFTER + 0.5)).toBe('nothing'); // loud but constant: it is the floor
  });

  it('stops at the length limit when the speaker never pauses', () => {
    const gate = new SpeechGate();
    feed(gate, 0.004, 0.3);
    expect(feed(gate, 0.2, MAX_SECONDS + 1)).toBe('full');
  });
});

describe('recording', () => {
  it('measures loudness', () => {
    expect(rmsOf(new Float32Array(100))).toBe(0);
    expect(rmsOf(new Float32Array(100).fill(0.5))).toBeCloseTo(0.5);
  });

  it('downsamples 48 kHz and 44.1 kHz to 16 kHz and stops when the buffer is full', () => {
    const out = new Int16Array(2000);
    const second = new Float32Array(4800).fill(0.5);
    expect(downsampleInto(second, 48_000, out, 0)).toBe(1600);
    expect(out[0]).toBe(Math.round(0.5 * 32767));
    expect(downsampleInto(second, 48_000, out, 1600)).toBe(400); // only 400 left
    expect(downsampleInto(second, 48_000, out, 2000)).toBe(0);
    expect(downsampleInto(new Float32Array(4410), 44_100, new Int16Array(5000), 0)).toBe(1600);
    const loud = new Int16Array(4);
    downsampleInto(new Float32Array(12).fill(3), 48_000, loud, 0);
    expect(loud[0]).toBe(32767); // clipped, never wrapped
  });

  it('writes a 16 kHz mono 16-bit wav', () => {
    const wav = encodeWav(Int16Array.from([1, -2, 3, 99]), 3);
    const view = new DataView(wav.buffer);
    const tag = (at: number) => String.fromCharCode(...wav.subarray(at, at + 4));
    expect(wav.byteLength).toBe(44 + 6);
    expect([tag(0), tag(8), tag(12), tag(36)]).toEqual(['RIFF', 'WAVE', 'fmt ', 'data']);
    expect(view.getUint32(24, true)).toBe(VOICE_RATE);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(40, true)).toBe(6);
    expect([view.getInt16(44, true), view.getInt16(46, true), view.getInt16(48, true)]).toEqual([1, -2, 3]);
  });
});
