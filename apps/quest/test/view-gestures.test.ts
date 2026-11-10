import { describe, expect, it } from 'vitest';
import { DEFAULT_GESTURE_CONFIG as CFG, ViewGestures, newHandInput, type HandInput, type PinchTarget } from '../src/app/view-gestures.ts';

/** Drives a ViewGestures with two reusable hand inputs and a clock. */
function rig(factor = 0) {
  const g = new ViewGestures();
  const left = newHandInput();
  const right = newHandInput();
  const s = { factor, on: 'part' as PinchTarget, now: 0 };
  const place = (h: HandInput, x: number, y: number, z: number) => {
    h.x = x;
    h.y = y;
    h.z = z;
  };
  const pinch = (h: HandInput, on: boolean) => {
    h.pinching = on;
    if (on) h.startedAt = s.now;
  };
  const step = (ms = 16) => {
    s.now += ms;
    g.update(s.now, left, right, s.factor, s.on);
    if (g.commit !== null) s.factor = g.commit; // what the store would do
  };
  /** Both hands pinch at ±half on x, at height y and depth z. */
  const grabBoth = (half: number, y = 0, z = 0.3) => {
    place(left, -half, y, z);
    place(right, half, y, z);
    pinch(left, true);
    pinch(right, true);
    step();
  };
  const spreadTo = (half: number, y = 0, z = 0.3) => {
    place(left, -half, y, z);
    place(right, half, y, z);
    step();
  };
  const release = () => {
    pinch(left, false);
    pinch(right, false);
    step();
  };
  return { g, left, right, s, place, pinch, step, grabBoth, spreadTo, release };
}

describe('view gestures: one hand', () => {
  it('a pinch that does not travel is not a drag', () => {
    const r = rig();
    r.place(r.right, 0.1, 0, 0.3);
    r.pinch(r.right, true);
    r.step();
    r.place(r.right, 0.11, 0.01, 0.3); // under 3 cm
    r.step();
    expect(r.g.mode).toBe('idle');
    expect(r.g.pose.x).toBe(0);
  });

  it('pinch and drag from a part moves the model with the hand, without a jump at the start', () => {
    const r = rig();
    r.place(r.right, 0.1, 0, 0.3);
    r.pinch(r.right, true);
    r.step();
    r.place(r.right, 0.14, 0, 0.3); // 4 cm: the drag starts here
    r.step();
    expect(r.g.mode).toBe('pan');
    expect(r.g.pose.x).toBeCloseTo(0); // grabbed where the hand is now
    r.place(r.right, 0.24, 0.05, 0.25);
    r.step();
    expect(r.g.pose.x).toBeCloseTo(0.1 * CFG.panGain);
    expect(r.g.pose.y).toBeCloseTo(0.05 * CFG.panGain);
    expect(r.g.pose.z).toBeCloseTo(-0.05 * CFG.panGain);
    r.pinch(r.right, false);
    r.step();
    expect(r.g.mode).toBe('idle');
    expect(r.g.pose.x).toBeCloseTo(0.1 * CFG.panGain); // stays where it was put
  });

  it('pinch and drag from empty space turns the model: sideways spins it, up and down tilts it', () => {
    const r = rig();
    r.s.on = 'space';
    r.place(r.right, 0.1, 0, 0.3);
    r.pinch(r.right, true);
    r.step();
    r.place(r.right, 0.14, 0, 0.3); // the drag starts here
    r.step();
    expect(r.g.mode).toBe('turn');
    expect(r.g.pose.yaw).toBeCloseTo(0); // no jump
    r.place(r.right, 0.24, 0.05, 0.3); // 10 cm right, 5 cm up
    r.step();
    expect(r.g.pose.yaw).toBeCloseTo(0.1 * CFG.turnGain); // the near side goes right
    expect(r.g.pose.pitch).toBeCloseTo(-0.05 * CFG.tiltGain); // the top tips away
    expect(r.g.pose.x).toBe(0); // turning does not move it
    expect(r.g.pose.y).toBe(0);
    r.pinch(r.right, false);
    r.step();
    expect(r.g.mode).toBe('idle');
    expect(r.g.pose.yaw).toBeCloseTo(0.1 * CFG.turnGain); // stays turned
  });

  it('tilt stops before the model flips over', () => {
    const r = rig();
    r.s.on = 'space';
    r.place(r.right, 0, 0, 0.3);
    r.pinch(r.right, true);
    r.step();
    r.place(r.right, 0, 0.05, 0.3);
    r.step();
    r.place(r.right, 0, 3, 0.3);
    r.step();
    expect(r.g.pose.pitch).toBe(-CFG.maxTilt);
    r.place(r.right, 0, -3, 0.3);
    r.step();
    expect(r.g.pose.pitch).toBe(CFG.maxTilt);
    r.g.tiltBy(9);
    expect(r.g.pose.pitch).toBe(CFG.maxTilt);
  });

  it('a second hand joining a one-hand turn carries on as a two-hand gesture, keeping the tilt', () => {
    const r = rig(1);
    r.s.on = 'space';
    r.place(r.right, 0.1, 0, 0);
    r.pinch(r.right, true);
    r.step();
    r.place(r.right, 0.2, 0.1, 0);
    r.step();
    r.place(r.right, 0.25, 0.15, 0);
    r.step();
    const { yaw, pitch } = r.g.pose;
    expect(pitch).not.toBe(0);
    r.place(r.left, -0.1, 0, 0);
    r.pinch(r.left, true);
    r.step();
    expect(r.g.mode).toBe('two');
    r.step();
    expect(r.g.pose.yaw).toBeCloseTo(yaw);
    expect(r.g.pose.pitch).toBe(pitch);
  });

  it('never drags while a pinch is pending on a toolbar button', () => {
    const r = rig();
    r.s.on = 'ui';
    r.place(r.right, 0.1, 0, 0.3);
    r.pinch(r.right, true);
    r.step();
    r.place(r.right, 0.3, 0, 0.3);
    r.step();
    expect(r.g.mode).toBe('idle');
  });

  it('keeps the model within reach', () => {
    const r = rig();
    r.place(r.right, 0, 0, 0);
    r.pinch(r.right, true);
    r.step();
    r.place(r.right, 0.05, 0, 0);
    r.step();
    r.place(r.right, 5, 5, 5);
    r.step();
    expect(r.g.pose.x).toBe(CFG.maxX);
    expect(r.g.pose.y).toBe(CFG.maxY);
    expect(r.g.pose.z).toBe(CFG.maxZ);
  });
});

describe('view gestures: two hands', () => {
  it('pulling apart explodes: 25 cm of travel is a full explode, previewed live and committed on release', () => {
    const r = rig(0);
    r.grabBoth(0.05);
    expect(r.g.mode).toBe('two');
    r.spreadTo(0.1); // +10 cm
    expect(r.g.preview).toBeCloseTo(0.4);
    expect(r.g.pose.zoom).toBe(1);
    r.spreadTo(0.175); // +25 cm
    expect(r.g.preview).toBeCloseTo(1);
    r.release();
    expect(r.s.factor).toBe(1);
    expect(r.g.preview).toBeNull();
  });

  it('pulling past fully exploded zooms in, up to the limit', () => {
    const r = rig(0);
    r.grabBoth(0.05);
    r.spreadTo(0.05 + (0.25 + 0.125) / 2); // a full explode plus half a step
    expect(r.g.preview).toBe(1);
    expect(r.g.pose.zoom).toBeCloseTo(1 + 0.5 * CFG.zoomRate);
    r.spreadTo(2);
    expect(r.g.pose.zoom).toBe(CFG.maxZoom);
    r.release();
    expect(r.s.factor).toBe(1);
    expect(r.g.pose.zoom).toBe(CFG.maxZoom); // zoom survives the release
  });

  it('pushing together zooms out first, then collapses, and a collapsed model is full size', () => {
    const r = rig(1);
    r.g.zoomBy(10); // at max zoom
    r.grabBoth(0.3);
    r.spreadTo(0.3 - 0.125 / 2); // back half a step of the zoom range
    expect(r.g.preview).toBe(1);
    expect(r.g.pose.zoom).toBeLessThan(CFG.maxZoom);
    expect(r.g.pose.zoom).toBeGreaterThan(1);
    r.spreadTo(0.02); // all the way in
    expect(r.g.pose.zoom).toBe(1);
    expect(r.g.preview).toBeLessThan(0.15);
    r.release();
    expect(r.s.factor).toBe(0);
    expect(r.g.pose.zoom).toBe(1);
  });

  it('the Collapse button returns a zoomed model to full size', () => {
    const r = rig(1);
    r.g.zoomBy(2);
    r.step();
    expect(r.g.pose.zoom).toBe(2);
    r.s.factor = 0;
    r.step();
    expect(r.g.pose.zoom).toBe(1);
  });

  it('a small change leaves the factor alone', () => {
    const r = rig(0.5);
    r.grabBoth(0.1);
    r.spreadTo(0.102);
    r.release();
    expect(r.s.factor).toBe(0.5);
  });

  it('moving both hands carries the model', () => {
    const r = rig(1);
    r.grabBoth(0.1, 0, 0.3);
    r.place(r.left, -0.1 + 0.1, 0.05, 0.3);
    r.place(r.right, 0.1 + 0.1, 0.05, 0.3);
    r.step();
    expect(r.g.pose.x).toBeCloseTo(0.1 * CFG.panGain);
    expect(r.g.pose.y).toBeCloseTo(0.05 * CFG.panGain);
    expect(r.g.pose.zoom).toBe(1);
    expect(r.g.pose.yaw).toBeCloseTo(0);
  });

  it('twisting turns the model about the vertical axis, past a small deadzone', () => {
    const r = rig(1);
    r.grabBoth(0.15, 0, 0); // 30 cm apart: far enough for the bearing to count fully
    const turn = (deg: number) => {
      const a = (deg * Math.PI) / 180;
      // Counter-clockwise seen from above: the right hand goes away from the viewer (-z).
      r.place(r.right, 0.15 * Math.cos(a), 0, -0.15 * Math.sin(a));
      r.place(r.left, -0.15 * Math.cos(a), 0, 0.15 * Math.sin(a));
      r.step();
    };
    turn(8);
    expect(r.g.pose.yaw).toBe(0); // inside the deadzone
    turn(36);
    expect(r.g.pose.yaw).toBeCloseTo(((36 - 10) * Math.PI) / 180);
    expect(r.g.preview).toBeCloseTo(1); // same distance: no explode or zoom change
    expect(r.g.pose.zoom).toBeCloseTo(1);
  });

  it('a straight pull only explodes and zooms: the model stays put, however far the hands are from it', () => {
    const r = rig(0);
    r.grabBoth(0.05, -0.16, 0.35); // hands low and well in front of the model
    r.spreadTo(0.3, -0.16, 0.35);
    expect(r.g.pose.zoom).toBe(CFG.maxZoom);
    expect(r.g.pose.x).toBeCloseTo(0);
    expect(r.g.pose.y).toBeCloseTo(0);
    expect(r.g.pose.z).toBeCloseTo(0);
    expect(r.g.pose.yaw).toBe(0);
  });

  it('ignores the bearing of hands that are close together', () => {
    const r = rig(0);
    // 8 cm apart and skewed 30° (palm offsets): then pulled straight out to 50 cm.
    r.place(r.left, -0.035, 0, 0.02);
    r.place(r.right, 0.035, 0, -0.02);
    r.pinch(r.left, true);
    r.pinch(r.right, true);
    r.step();
    for (const half of [0.06, 0.1, 0.15, 0.2, 0.25]) {
      r.place(r.left, -half, 0, 0.02);
      r.place(r.right, half, 0, -0.02);
      r.step();
    }
    expect(Math.abs(r.g.pose.yaw)).toBeLessThan(0.03);
  });

  it('the hand that lets go last does not start dragging the model', () => {
    const r = rig(0);
    r.grabBoth(0.05);
    r.spreadTo(0.3);
    r.pinch(r.right, false);
    r.step();
    expect(r.g.mode).toBe('idle');
    const x = r.g.pose.x;
    r.place(r.left, -0.6, 0.2, 0.3); // still pinching, still moving
    r.step();
    expect(r.g.mode).toBe('idle');
    expect(r.g.pose.x).toBe(x);
    r.pinch(r.left, false);
    r.step();
    r.pinch(r.left, true); // a fresh pinch can drag again
    r.step();
    r.place(r.left, -0.5, 0.2, 0.3);
    r.step();
    expect(r.g.mode).toBe('pan');
  });

  it('pinches that start far apart in time are two separate presses, not a two-hand gesture', () => {
    const r = rig(0);
    r.place(r.left, -0.1, 0, 0);
    r.place(r.right, 0.1, 0, 0);
    r.pinch(r.left, true);
    r.step(CFG.pairWindowMs + 100);
    r.pinch(r.right, true);
    r.step();
    expect(r.g.mode).toBe('idle');
  });

  it('a second hand joining a one-hand drag carries on as a two-hand gesture', () => {
    const r = rig(1);
    r.place(r.right, 0.1, 0, 0);
    r.pinch(r.right, true);
    r.step();
    r.place(r.right, 0.2, 0, 0);
    r.step();
    expect(r.g.mode).toBe('pan');
    r.step(CFG.pairWindowMs + 100);
    r.place(r.left, -0.1, 0, 0);
    r.pinch(r.left, true);
    r.step();
    expect(r.g.mode).toBe('two');
    const x = r.g.pose.x;
    r.step();
    expect(r.g.pose.x).toBeCloseTo(x); // no jump on the hand-over
  });
});

describe('view gestures: reset and equivalents', () => {
  it('reset returns to the authored placement', () => {
    const r = rig(1);
    r.g.panBy(0.2, 0.1, -0.1);
    r.g.zoomBy(1.5);
    r.g.turnBy(1);
    r.g.tiltBy(0.5);
    r.g.reset();
    expect(r.g.pose).toEqual({ x: 0, y: 0, z: 0, yaw: 0, pitch: 0, zoom: 1 });
  });

  it('the keyboard equivalents respect the same limits', () => {
    const r = rig(1);
    r.g.zoomBy(0.1);
    expect(r.g.pose.zoom).toBe(1);
    r.g.zoomBy(100);
    expect(r.g.pose.zoom).toBe(CFG.maxZoom);
    r.g.panBy(9, -9, 9);
    expect(r.g.pose.x).toBe(CFG.maxX);
    expect(r.g.pose.y).toBe(CFG.minY);
  });

  it('cancel drops a gesture without committing', () => {
    const r = rig(0);
    r.grabBoth(0.05);
    r.spreadTo(0.3);
    r.g.cancel();
    expect(r.g.mode).toBe('idle');
    expect(r.g.preview).toBeNull();
    expect(r.g.commit).toBeNull();
  });
});
