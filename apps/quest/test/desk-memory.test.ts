import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Matrix4, Quaternion, Vector3 } from '@iwsdk/core';
import { DeskMemory, SdkAnchorFrame, type AnchorFrame, type DeskPose } from '../src/app/desk-memory.ts';

class MemoryStorage {
  private m = new Map<string, string>();
  getItem = (k: string) => this.m.get(k) ?? null;
  setItem = (k: string, v: string) => void this.m.set(k, v);
  removeItem = (k: string) => void this.m.delete(k);
}

beforeEach(() => vi.stubGlobal('localStorage', new MemoryStorage()));
afterEach(() => vi.unstubAllGlobals());

/** An anchor at `at`, turned `yaw` about world up. */
function frame(id: string | null, at: [number, number, number] = [0, 0, 0], yaw = 0): AnchorFrame {
  const m = new Matrix4().compose(new Vector3(...at), new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw), new Vector3(1, 1, 1));
  return { id: () => id, matrix: () => m };
}

const pose = (): DeskPose => ({ x: 0, y: 0, z: 0, yaw: 0 });

describe('desk memory', () => {
  it('returns the stage to the same real spot when the reference space has moved and turned', () => {
    const mem = new DeskMemory();
    // Session 1: the anchor sits at the reference origin; the stage is on the desk.
    expect(mem.save(frame('a1'), { x: 0.3, y: 0.95, z: -0.6, yaw: 0.4 })).toBe(true);
    // Session 2: the same real anchor now reports 1 m to the right and turned 90°.
    const out = pose();
    expect(mem.recall(frame('a1', [1, 0, 0], Math.PI / 2), out)).toBe(true);
    // Rotating (0.3, -0.6) by 90° about up gives (-0.6, -0.3); then shift by +1 on x.
    expect(out.x).toBeCloseTo(0.4, 6);
    expect(out.y).toBeCloseTo(0.95, 6);
    expect(out.z).toBeCloseTo(-0.3, 6);
    expect(out.yaw).toBeCloseTo(0.4 + Math.PI / 2, 6);
  });

  it('recalls nothing for a different anchor, without an anchor, or with nothing saved', () => {
    const mem = new DeskMemory();
    const out = pose();
    expect(mem.recall(frame('a1'), out)).toBe(false); // nothing saved
    expect(mem.save(frame(null), { x: 1, y: 1, z: 1, yaw: 0 })).toBe(false); // no anchor: not saved
    expect(DeskMemory.has()).toBe(false);
    mem.save(frame('a1'), { x: 1, y: 1, z: 1, yaw: 0 });
    expect(mem.recall(frame('a2'), out)).toBe(false); // anchor replaced since
    expect(mem.recall(frame(null), out)).toBe(false); // anchor not back yet
    DeskMemory.forget();
    expect(mem.recall(frame('a1'), out)).toBe(false);
  });

  it('ignores a corrupt saved entry', () => {
    localStorage.setItem('explode:desk:v1', '{"anchor":"a1","local":[1,2,3]}');
    expect(new DeskMemory().recall(frame('a1'), pose())).toBe(false);
    localStorage.setItem('explode:desk:v1', 'not json');
    expect(new DeskMemory().recall(frame('a1'), pose())).toBe(false);
  });
});

describe('SDK anchor frame', () => {
  it('reports an anchor only after it has been there for a few frames, with the SDK-stored id', () => {
    const group = { matrixWorld: new Matrix4().makeTranslation(1, 2, 3), updateMatrixWorld: () => undefined };
    const system: { xrAnchor?: object; anchoredGroup: typeof group } = { anchoredGroup: group };
    const f = new SdkAnchorFrame(system);
    localStorage.setItem('iwsdk_scene_anchor_uuid', 'uuid-1');
    f.tick();
    expect(f.id()).toBeNull(); // no anchor yet
    system.xrAnchor = {};
    f.tick();
    f.tick();
    expect(f.id()).toBeNull(); // too new: the group may still hold last session's pose
    f.tick();
    expect(f.id()).toBe('uuid-1');
    expect(f.matrix().elements[12]).toBe(1);
    system.xrAnchor = {}; // replaced
    f.tick();
    expect(f.id()).toBeNull();
  });

  it('reports no anchor when the SDK shape differs', () => {
    const f = new SdkAnchorFrame({});
    for (let i = 0; i < 5; i++) f.tick();
    expect(f.id()).toBeNull();
    expect(new SdkAnchorFrame(null).id()).toBeNull();
  });
});
