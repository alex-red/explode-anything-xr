/**
 * Field-of-view budgets (docs/WIN_PLAN.md W7, ADR-0014).
 *
 * Angles are measured from the eye like a headset's view frustum: turn to look at the model (the
 * stage's anchor), then measure right/up in that view (tangent angles). Not around straight
 * ahead: a seated viewer looks down at a desk.
 *
 * - `wide` (default) fits the Quest 3S, about 96° × 90°, with a little margin. The model, the
 *   caption and the toolbar are inside it. The evidence panel and gesture card open beside the
 *   model and may need a glance sideways.
 * - `narrow` fits a glasses-class view, about 70° × 66°: everything a lesson needs is inside it,
 *   including the evidence panel and gesture card when opened.
 */
import { BufferGeometry, Euler, Float32BufferAttribute, Group, LineBasicMaterial, LineLoop, Quaternion, Vector3, type Object3D } from '@iwsdk/core';

export type LayoutMode = 'wide' | 'narrow';

/** Half-angles, degrees. */
export const FOV_BUDGET: Record<LayoutMode, { h: number; v: number }> = {
  wide: { h: 46, v: 43 },
  narrow: { h: 33, v: 31 },
};

const DEG = Math.PI / 180;

/** Yaw (right is positive) and pitch (up is positive) of the line from `eye` to the anchor origin. */
export function gazeOf(eye: Vector3): { yaw: number; pitch: number } {
  const len = Math.hypot(eye.x, eye.y, eye.z) || 1;
  const fx = -eye.x / len;
  const fy = -eye.y / len;
  const fz = -eye.z / len;
  return { yaw: Math.atan2(fx, -fz), pitch: Math.asin(Math.max(-1, Math.min(1, fy))) };
}

const qGaze = new Quaternion();
const qLocal = new Quaternion();
const euler = new Euler(0, 0, 0, 'YXZ');
const dir = new Vector3();

/** The rotation that looks from `eye` at the anchor origin (–z forward, level roll). */
function gazeRotation(eye: Vector3, out: Quaternion): Quaternion {
  const g = gazeOf(eye);
  return out.setFromEuler(euler.set(g.pitch, -g.yaw, 0, 'YXZ'));
}

/**
 * Put `obj` at `dist` metres from `eye`, `h`° right of and `v`° above the gaze at the model
 * (frustum angles), turned to face the eye. All in the anchor's frame (the UI's parent frame).
 */
export function placeFacing(obj: Object3D, eye: Vector3, h: number, v: number, dist: number): void {
  gazeRotation(eye, qGaze);
  qLocal.setFromEuler(euler.set(Math.atan(Math.tan(v * DEG) * Math.cos(h * DEG)), -h * DEG, 0, 'YXZ'));
  obj.quaternion.copy(qGaze).multiply(qLocal);
  dir.set(Math.tan(h * DEG), Math.tan(v * DEG), -1).normalize().applyQuaternion(qGaze);
  obj.position.copy(eye).addScaledVector(dir, dist);
}

/**
 * Debug only: the two budgets drawn as frames around the gaze at the model, so a layout can be
 * judged in the emulator (key F). Rebuilt only when the eye moves (at recenter).
 */
export class FovMask {
  readonly group = new Group();
  private readonly frames: Record<LayoutMode, LineLoop>;

  constructor() {
    const make = (color: number) => {
      const geo = new BufferGeometry();
      geo.setAttribute('position', new Float32BufferAttribute(new Float32Array(12), 3));
      const line = new LineLoop(geo, new LineBasicMaterial({ color, transparent: true, opacity: 0.8, depthTest: false }));
      line.renderOrder = 100;
      this.group.add(line);
      return line;
    };
    this.frames = { wide: make(0x66ccff), narrow: make(0xffaa33) };
    this.group.visible = false;
  }

  /** Redraw both frames for an eye at `eye` (anchor frame), at `dist` metres. */
  update(eye: Vector3, dist = 0.7): void {
    gazeRotation(eye, qGaze);
    for (const mode of ['wide', 'narrow'] as const) {
      const b = FOV_BUDGET[mode];
      const pos = this.frames[mode].geometry.getAttribute('position') as Float32BufferAttribute;
      const corners = [
        [-b.h, -b.v],
        [b.h, -b.v],
        [b.h, b.v],
        [-b.h, b.v],
      ] as const;
      corners.forEach(([h, v], i) => {
        dir.set(Math.tan(h * DEG) * dist, Math.tan(v * DEG) * dist, -dist).applyQuaternion(qGaze).add(eye);
        pos.setXYZ(i, dir.x, dir.y, dir.z);
      });
      pos.needsUpdate = true;
    }
  }
}
