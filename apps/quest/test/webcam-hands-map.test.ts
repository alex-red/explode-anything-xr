import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WEBCAM_HAND_CONFIG as CFG,
  HandSmoother,
  PalmCalibration,
  handTarget,
  palmSize,
  pinchValue,
  quatFromForward,
  reachFromPalm,
  sideOf,
  yawOf,
  type Landmark,
  type Quat,
  type Vec3,
} from '../src/dev/webcam-hands-map.ts';

/** Rotate v by unit quaternion q. */
function rotate(q: Quat, v: Vec3): Vec3 {
  const [x, y, z, w] = q;
  const tx = 2 * (y * v[2] - z * v[1]);
  const ty = 2 * (z * v[0] - x * v[2]);
  const tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
}

/**
 * A flat open hand centred at (cx, cy) in the frame with palm length `size` (frame heights),
 * fingers up. Thumb-index gap is `gap` × palm length.
 */
function hand(cx: number, cy: number, size: number, gap = 0.9, aspect = 16 / 9): Landmark[] {
  const lm: Landmark[] = Array.from({ length: 21 }, () => ({ x: cx, y: cy, z: 0 }));
  const at = (dx: number, dy: number): Landmark => ({ x: cx + (dx * size) / aspect, y: cy + dy * size, z: 0 });
  // Palm centre is the mean of 0, 5, 9, 17; place them symmetrically round (cx, cy).
  lm[0] = at(0, 0.5);
  lm[9] = at(0, -0.5);
  lm[5] = at(-0.3, -0.2);
  lm[17] = at(0.3, 0.2);
  lm[8] = at(-0.35, -1.2);
  lm[4] = at(-0.35 + gap, -1.2);
  return lm;
}

const ASPECT = 16 / 9;
const HEAD = { position: [0, 1.6, 0] as Vec3, yaw: 0 };

describe('webcam hand mapping', () => {
  it('maps MediaPipe handedness (selfie convention) to your actual hand', () => {
    expect(sideOf('Left')).toBe('right');
    expect(sideOf('Right')).toBe('left');
    expect(sideOf('Left', true)).toBe('left');
  });

  it('reads pinch from world landmarks in metres', () => {
    const lm = hand(0.5, 0.5, 0.2);
    const world = (gap: number): Landmark[] => {
      const w = Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0 }));
      w[4] = { x: gap, y: 0, z: 0 };
      return w;
    };
    expect(pinchValue(lm, world(0.005), ASPECT)).toBe(1);
    expect(pinchValue(lm, world(0.08), ASPECT)).toBe(0);
    // IWER presses at 0.9 and releases at 0.7: that is about 2 cm and 3 cm.
    expect(pinchValue(lm, world(0.019), ASPECT)).toBeGreaterThan(0.9);
    expect(pinchValue(lm, world(0.03), ASPECT)).toBeLessThan(0.7);
  });

  it('falls back to image landmarks for pinch', () => {
    expect(pinchValue(hand(0.5, 0.5, 0.2, 0.05), undefined, ASPECT)).toBe(1);
    expect(pinchValue(hand(0.5, 0.5, 0.2, 1.0), undefined, ASPECT)).toBe(0);
  });

  it('palm size is in frame heights and independent of aspect', () => {
    expect(palmSize(hand(0.5, 0.5, 0.2), ASPECT)).toBeCloseTo(0.2, 5);
    expect(palmSize(hand(0.5, 0.5, 0.2, 0.9, 4 / 3), 4 / 3)).toBeCloseTo(0.2, 5);
  });

  it('reach grows as the hand looks bigger and stays clamped', () => {
    expect(reachFromPalm(0.2, 0.2)).toBeCloseTo(CFG.reach);
    expect(reachFromPalm(0.3, 0.2)).toBeGreaterThan(CFG.reach);
    expect(reachFromPalm(0.15, 0.2)).toBeLessThan(CFG.reach);
    expect(reachFromPalm(10, 0.2)).toBe(CFG.maxReach);
    expect(reachFromPalm(0.01, 0.2)).toBe(CFG.minReach);
    expect(reachFromPalm(0, 0.2)).toBe(CFG.reach);
  });

  it('a centred hand sits in front of and below the eyes', () => {
    const t = handTarget(hand(0.5, 0.5, 0.2), undefined, ASPECT, 'right', HEAD, 0.2);
    expect(t.position[0]).toBeCloseTo(0);
    expect(t.position[1]).toBeCloseTo(1.6 + CFG.heightOffset);
    expect(t.position[2]).toBeCloseTo(-CFG.reach);
  });

  it('the un-mirrored frame maps image-left to your right', () => {
    const t = handTarget(hand(0.2, 0.5, 0.2), undefined, ASPECT, 'right', HEAD, 0.2);
    expect(t.position[0]).toBeGreaterThan(0.1);
    const up = handTarget(hand(0.5, 0.2, 0.2), undefined, ASPECT, 'right', HEAD, 0.2);
    expect(up.position[1]).toBeGreaterThan(1.6 + CFG.heightOffset);
  });

  it('the ray runs from the shoulder through the hand', () => {
    const t = handTarget(hand(0.5, 0.5, 0.2), undefined, ASPECT, 'right', HEAD, 0.2);
    const dir = rotate(t.quaternion, [0, 0, -1]);
    const sh: Vec3 = [CFG.shoulder[0], 1.6 + CFG.shoulder[1], CFG.shoulder[2]];
    const d: Vec3 = [t.position[0] - sh[0], t.position[1] - sh[1], t.position[2] - sh[2]];
    const n = Math.hypot(...d);
    expect(dir[0]).toBeCloseTo(d[0] / n, 5);
    expect(dir[1]).toBeCloseTo(d[1] / n, 5);
    expect(dir[2]).toBeCloseTo(d[2] / n, 5);
    // A right hand straight ahead points slightly inward (toward -x) and forward.
    expect(dir[0]).toBeLessThan(0);
    expect(dir[2]).toBeLessThan(-0.5);
  });

  it('follows the head yaw', () => {
    const yaw = Math.PI / 2; // facing -X
    const t = handTarget(hand(0.5, 0.5, 0.2), undefined, ASPECT, 'right', { position: [0, 1.6, 0], yaw }, 0.2);
    expect(t.position[0]).toBeCloseTo(-CFG.reach);
    expect(t.position[2]).toBeCloseTo(0);
  });

  it('yawOf inverts a rotation about +Y', () => {
    for (const yaw of [0, 0.7, -1.2, 3]) {
      const q: Quat = [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)];
      expect(yawOf(q)).toBeCloseTo(yaw, 6);
    }
  });

  it('quatFromForward maps -Z onto the direction, including the opposite pole', () => {
    for (const d of [[0, 0, -1], [1, 0, 0], [0, 1, 0], [0.6, -0.48, -0.64], [0, 0, 1]] as Vec3[]) {
      const r = rotate(quatFromForward(d), [0, 0, -1]);
      expect(r[0]).toBeCloseTo(d[0], 6);
      expect(r[1]).toBeCloseTo(d[1], 6);
      expect(r[2]).toBeCloseTo(d[2], 6);
    }
  });

  it('smooths toward new samples and resets', () => {
    const s = new HandSmoother(0.5, 1);
    const a = { position: [0, 0, 0] as Vec3, quaternion: [0, 0, 0, 1] as Quat, pinch: 0 };
    const b = { position: [1, 0, 0] as Vec3, quaternion: [0, 0, 0, 1] as Quat, pinch: 1 };
    s.push(a);
    const out = s.push(b);
    expect(out.position[0]).toBeCloseTo(0.5);
    expect(out.pinch).toBe(1);
    s.reset();
    expect(s.push(b).position[0]).toBe(1);
  });

  it('calibrates palm size from the first samples only', () => {
    const c = new PalmCalibration(2);
    expect(c.push(0.2)).toBeCloseTo(0.2);
    expect(c.push(0.4)).toBeCloseTo(0.3);
    expect(c.push(1.0)).toBeCloseTo(0.3);
    c.reset();
    expect(c.push(0.5)).toBeCloseTo(0.5);
  });
});
