import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Matrix4 } from '@iwsdk/core';
import { Sfx } from '../src/app/audio.ts';
import { FakeAudioContext } from './fake-audio.ts';

class MemoryStorage {
  private m = new Map<string, string>();
  getItem = (k: string) => this.m.get(k) ?? null;
  setItem = (k: string, v: string) => void this.m.set(k, v);
  removeItem = (k: string) => void this.m.delete(k);
}

beforeEach(() => {
  FakeAudioContext.instances = [];
  vi.stubGlobal('localStorage', new MemoryStorage());
  vi.stubGlobal('AudioContext', FakeAudioContext);
});
afterEach(() => vi.unstubAllGlobals());

const ctx = () => FakeAudioContext.instances[0]!;
type Panner = { kind: string; positionX: { value: number }; positionY: { value: number }; positionZ: { value: number } };
const panners = () => ctx().nodes.filter((n) => n.kind === 'panner') as unknown as Panner[];

describe('sound', () => {
  it('never starts audio on its own: ambient sounds wait for a sound that answers a press', () => {
    const sfx = new Sfx();
    sfx.boot({ x: 0, y: 1, z: -0.7 });
    sfx.hum(true);
    sfx.dim(true);
    expect(FakeAudioContext.instances).toHaveLength(0);
    expect(sfx.played).toEqual([]);
    sfx.click();
    expect(FakeAudioContext.instances).toHaveLength(1);
    sfx.boot({ x: 0, y: 1, z: -0.7 });
    expect(sfx.played).toEqual(['click', 'boot']);
  });

  it('places a sound at its part, and a placeless one goes straight to the master', () => {
    const sfx = new Sfx();
    sfx.click();
    expect(panners()).toHaveLength(0);
    sfx.unplug({ x: 0.2, y: 1.1, z: -0.6 });
    expect(panners().length).toBeGreaterThan(0);
    for (const p of panners()) expect([p.positionX.value, p.positionY.value, p.positionZ.value]).toEqual([0.2, 1.1, -0.6]);
  });

  it('plays the failure spreading part by part, one voice per affected part', () => {
    const sfx = new Sfx();
    sfx.click();
    const before = panners().length;
    sfx.cascade([
      { x: 0, y: 1, z: 0 },
      { x: 0.1, y: 1, z: 0 },
      { x: 0.2, y: 1, z: 0 },
    ]);
    expect(panners().length - before).toBe(3);
    expect(panners().slice(before).map((p) => p.positionX.value)).toEqual([0, 0.1, 0.2]);
  });

  it('cycles on → quiet → off, remembers it, and plays nothing when off', () => {
    const sfx = new Sfx();
    expect(sfx.level).toBe('on');
    expect(sfx.cycleLevel()).toBe('quiet');
    expect(new Sfx().level).toBe('quiet'); // remembered between visits
    expect(sfx.cycleLevel()).toBe('off');
    sfx.click();
    sfx.repair(null);
    expect(FakeAudioContext.instances).toHaveLength(0);
    expect(sfx.cycleLevel()).toBe('on');
    sfx.click();
    expect(sfx.played).toEqual(['click']);
  });

  it('the hum starts once, stops on cue, and turning sound off silences it', () => {
    const sfx = new Sfx();
    sfx.click();
    sfx.hum(true, { x: 0, y: 1, z: -0.7 });
    sfx.hum(true, { x: 0, y: 1, z: -0.7 }); // no second hum
    expect(sfx.played.filter((n) => n === 'hum')).toHaveLength(1);
    const oscs = ctx().nodes.filter((n) => n.kind === 'oscillator') as unknown as Array<{ stops: number[] }>;
    const humOscs = oscs.slice(-3);
    expect(humOscs.every((o) => o.stops.length === 0)).toBe(true);
    sfx.hum(false);
    expect(humOscs.every((o) => o.stops.length === 1)).toBe(true);
    sfx.hum(true);
    sfx.setLevel('off');
    expect(ctx().nodes.filter((n) => n.kind === 'oscillator').slice(-3).every((o) => (o as unknown as { stops: number[] }).stops.length === 1)).toBe(true);
  });

  it('moves the listener with the head', () => {
    const sfx = new Sfx();
    sfx.click();
    const head = new Matrix4().makeRotationY(Math.PI / 2).setPosition(1, 1.5, 2);
    sfx.updateListener({ matrixWorld: head });
    const l = ctx().listener;
    expect([l.positionX.value, l.positionY.value, l.positionZ.value]).toEqual([1, 1.5, 2]);
    // Turned 90° left: looking along -x.
    expect(l.forwardX.value).toBeCloseTo(-1);
    expect(l.forwardZ.value).toBeCloseTo(0);
    expect(l.upY.value).toBeCloseTo(1);
  });
});
