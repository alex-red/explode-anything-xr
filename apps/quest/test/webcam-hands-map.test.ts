import { describe, expect, it } from 'vitest';
import {
  ClickStabilizer,
  DEFAULT_WEBCAM_HAND_CONFIG as CFG,
  PalmCalibration,
  PinchDetector,
  PointerFilter,
  palmPointer,
  palmSize,
  pinchGapM,
  pinchRatio,
  pointerFor,
  pointerPose,
  reachFromPalm,
  rotate,
  sideOf,
  type HeadPose,
  type Landmark,
  type Quat,
  type Vec3,
} from '../src/dev/webcam-hands-map.ts';

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

/** World landmarks (metres) with a 9.5 cm palm and the given thumb-index gap. */
function world(gap: number): Landmark[] {
  const w = Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0 }));
  w[9] = { x: 0, y: 0.095, z: 0 };
  w[8] = { x: 0.03, y: 0.15, z: 0 };
  w[4] = { x: 0.03 + gap, y: 0.15, z: 0 };
  return w;
}

const ASPECT = 16 / 9;
const HEAD: HeadPose = { position: [0, 1.6, 0], quaternion: [0, 0, 0, 1] };
const yawQuat = (yaw: number): Quat => [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)];

/** Shortest distance from point p to the ray starting at `pose.position` along its -Z. */
function rayMiss(pose: { position: Vec3; quaternion: Quat }, p: Vec3): number {
  const d = rotate(pose.quaternion, [0, 0, -1]);
  const w: Vec3 = [p[0] - pose.position[0], p[1] - pose.position[1], p[2] - pose.position[2]];
  const along = w[0] * d[0] + w[1] * d[1] + w[2] * d[2];
  return Math.hypot(w[0] - d[0] * along, w[1] - d[1] * along, w[2] - d[2] * along);
}

describe('webcam hand mapping', () => {
  it('maps MediaPipe handedness (selfie convention) to your actual hand', () => {
    expect(sideOf('Left')).toBe('right');
    expect(sideOf('Right')).toBe('left');
    expect(sideOf('Left', true)).toBe('left');
  });

  it('palm size is in frame heights and independent of aspect', () => {
    expect(palmSize(hand(0.5, 0.5, 0.2), ASPECT)).toBeCloseTo(0.2, 5);
    expect(palmSize(hand(0.5, 0.5, 0.2, 0.9, 4 / 3), 4 / 3)).toBeCloseTo(0.2, 5);
  });

  it('pointer coordinates: centre is 0,0; the un-mirrored frame maps image-left to your right, up is up', () => {
    const c = palmPointer(hand(0.5, 0.5, 0.2));
    expect(c.u).toBeCloseTo(0);
    expect(c.v).toBeCloseTo(0);
    expect(palmPointer(hand(0.2, 0.5, 0.2)).u).toBeCloseTo(0.3);
    expect(palmPointer(hand(0.5, 0.2, 0.2)).v).toBeCloseTo(0.3);
  });

  it('reach grows as the hand looks bigger and stays clamped', () => {
    expect(reachFromPalm(0.2, 0.2)).toBeCloseTo(CFG.reach);
    expect(reachFromPalm(0.25, 0.2)).toBeGreaterThan(CFG.reach);
    expect(reachFromPalm(0.18, 0.2)).toBeLessThan(CFG.reach);
    expect(reachFromPalm(10, 0.2)).toBe(CFG.maxReach);
    expect(reachFromPalm(0.01, 0.2)).toBe(CFG.minReach);
    expect(reachFromPalm(0, 0.2)).toBe(CFG.reach);
  });

  describe('pointer pose', () => {
    it('puts the hand on the line of sight and the ray along it', () => {
      for (const [u, v] of [[0, 0], [0.3, 0.1], [-0.25, -0.2]] as const) {
        const pose = pointerPose(u, v, 0.4, HEAD);
        const dir = rotate(pose.quaternion, [0, 0, -1]);
        // Hand is 0.4 m from the eyes, exactly along the ray direction.
        expect(pose.position[0]).toBeCloseTo(HEAD.position[0] + dir[0] * 0.4, 6);
        expect(pose.position[1]).toBeCloseTo(HEAD.position[1] + dir[1] * 0.4, 6);
        expect(pose.position[2]).toBeCloseTo(HEAD.position[2] + dir[2] * 0.4, 6);
        // So the ray passes back through the eyes: no parallax between the hand and its hit point.
        expect(rayMiss({ position: pose.position, quaternion: pose.quaternion }, [0, 1.6, 0])).toBeLessThan(1e-6);
      }
    });

    it('frame centre looks slightly down; your right is right; up is up', () => {
      const centre = rotate(pointerPose(0, 0, 0.4, HEAD).quaternion, [0, 0, -1]);
      expect(centre[0]).toBeCloseTo(0);
      expect(Math.asin(centre[1]) * (180 / Math.PI)).toBeCloseTo(CFG.pitchOffsetDeg);
      expect(rotate(pointerPose(0.2, 0, 0.4, HEAD).quaternion, [0, 0, -1])[0]).toBeGreaterThan(0.3);
      expect(rotate(pointerPose(0, 0.2, 0.4, HEAD).quaternion, [0, 0, -1])[1]).toBeGreaterThan(centre[1]);
    });

    it('hits real targets: the pointer for a direction casts a ray through that point', () => {
      // Toolbar and node positions reported by the app in an emulator session.
      const targets: Vec3[] = [[-0.26, 1.51, -0.6], [-0.36, 1.33, -0.49], [0.04, 1.49, -0.67], [-0.02, 1.38, -0.65]];
      for (const p of targets) {
        const dir: Vec3 = [p[0] - HEAD.position[0], p[1] - HEAD.position[1], p[2] - HEAD.position[2]];
        const { u, v } = pointerFor(dir);
        expect(Math.abs(u)).toBeLessThan(0.4); // reachable without going to the frame edge
        expect(Math.abs(v)).toBeLessThan(0.4);
        expect(rayMiss(pointerPose(u, v, 0.4, HEAD), p)).toBeLessThan(1e-6);
      }
    });

    it('follows the head: position and full orientation', () => {
      const head: HeadPose = { position: [1, 1.5, -2], quaternion: yawQuat(Math.PI / 2) }; // facing -X
      const pose = pointerPose(0, (0 - CFG.pitchOffsetDeg) / CFG.pitchSpanDeg, 0.4, head); // level
      expect(pose.position[0]).toBeCloseTo(1 - 0.4);
      expect(pose.position[1]).toBeCloseTo(1.5);
      expect(pose.position[2]).toBeCloseTo(-2);
    });
  });

  describe('pinch', () => {
    it('measures the gap against palm length, preferring world landmarks', () => {
      expect(pinchGapM(world(0.03))).toBeCloseTo(0.03);
      expect(pinchGapM(undefined)).toBeNull();
      expect(pinchRatio(hand(0.5, 0.5, 0.2), world(0.019), ASPECT)).toBeCloseTo(0.2);
      expect(pinchRatio(hand(0.5, 0.5, 0.2, 0.5), undefined, ASPECT)).toBeCloseTo(0.5);
    });

    it('presses under about 2.5 cm and releases over about 3.2 cm on a 9.5 cm palm', () => {
      expect(CFG.pinchPress * 0.095).toBeCloseTo(0.0247, 3);
      expect(CFG.pinchRelease * 0.095).toBeCloseTo(0.0323, 3);
    });

    it('is a debounced switch with separate press and release levels', () => {
      const d = new PinchDetector();
      expect(d.push(0.2)).toBe(false); // one sample is not enough
      expect(d.push(0.5)).toBe(false);
      expect(d.push(0.2)).toBe(false);
      expect(d.push(0.2)).toBe(true); // two in a row
      expect(d.push(0.3)).toBe(true); // between the levels: holds
      expect(d.push(0.4)).toBe(true);
      expect(d.push(0.3)).toBe(true); // a single open sample does not release
      expect(d.push(0.4)).toBe(true);
      expect(d.push(0.4)).toBe(false);
      d.push(0.2);
      d.reset();
      expect(d.push(0.2)).toBe(false);
    });
  });

  describe('click stabiliser', () => {
    const feed = (s: ClickStabilizer, rows: Array<[t: number, u: number, pinched: boolean, other?: boolean]>) =>
      rows.map(([t, u, pinched, other]) => s.push(t, u, 0, pinched, other ?? false));

    it('rewinds to before the fingers closed, sends the pinch one sample later, and releases on the same spot', () => {
      const s = new ClickStabilizer();
      const out = feed(s, [
        [0, 0.1, false],
        [33, 0.1, false],
        [66, 0.1, false],
        [100, 0.12, false], // fingers start closing: the palm drifts
        [133, 0.14, false],
        [166, 0.16, true], // pinch detected
        [200, 0.17, true],
        [233, 0.18, true],
        [266, 0.19, false], // released
        [300, 0.2, false],
      ]);
      expect(out[4]).toEqual({ u: 0.14, v: 0, pinch: false });
      expect(out[5]).toEqual({ u: 0.1, v: 0, pinch: false }); // back at t=33 (≥120 ms earlier); pinch not sent yet
      expect(out[6]).toEqual({ u: 0.1, v: 0, pinch: true });
      expect(out[7]).toEqual({ u: 0.1, v: 0, pinch: true });
      expect(out[8]).toEqual({ u: 0.1, v: 0, pinch: false }); // the release lands on the frozen spot
      expect(out[9]).toEqual({ u: 0.2, v: 0, pinch: false }); // then the pointer is live again
    });

    it('a long hold becomes a drag that follows the hand', () => {
      const s = new ClickStabilizer();
      feed(s, [[0, 0.1, false], [200, 0.1, true], [233, 0.1, true]]);
      expect(s.push(200 + CFG.clickHoldMs - 1, 0.3, 0, true, false).u).toBe(0.1);
      expect(s.push(200 + CFG.clickHoldMs + 1, 0.3, 0, true, false)).toEqual({ u: 0.3, v: 0, pinch: true });
      expect(s.push(200 + CFG.clickHoldMs + 40, 0.35, 0, true, false).u).toBe(0.35);
    });

    it('both hands pinching unfreezes at once, for the two-hand pull', () => {
      const s = new ClickStabilizer();
      feed(s, [[0, 0.1, false], [200, 0.1, true]]);
      expect(s.push(233, 0.2, 0, true, true)).toEqual({ u: 0.2, v: 0, pinch: true });
    });

    it('reset drops a pinch in progress', () => {
      const s = new ClickStabilizer();
      feed(s, [[0, 0.1, false], [200, 0.1, true], [233, 0.1, true]]);
      s.reset();
      expect(s.push(266, 0.4, 0, false, false)).toEqual({ u: 0.4, v: 0, pinch: false });
    });
  });

  it('smooths heavily when nearly still and lightly when moving fast', () => {
    const f = new PointerFilter();
    expect(f.push(0, 0)).toEqual({ u: 0, v: 0 });
    expect(f.push(0.004, 0).u).toBeLessThan(0.0015); // jitter is mostly absorbed
    f.reset();
    f.push(0, 0);
    expect(f.push(0.2, 0).u).toBeCloseTo(0.2 * CFG.smoothFast); // a real move mostly goes through
  });

  it('calibrates palm size from the first samples only, and can be seeded', () => {
    const c = new PalmCalibration(2);
    expect(c.push(0.2)).toBeCloseTo(0.2);
    expect(c.push(0.4)).toBeCloseTo(0.3);
    expect(c.push(1.0)).toBeCloseTo(0.3);
    c.reset();
    expect(c.push(0.5)).toBeCloseTo(0.5);
    expect(c.settled).toBe(false);
    c.seed(0.25);
    expect(c.settled).toBe(true);
    expect(c.push(0.9)).toBeCloseTo(0.25);
  });
});
