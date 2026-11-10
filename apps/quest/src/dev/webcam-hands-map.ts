/**
 * Webcam hand tracking → IWER emulated hands: the pure maths (dev-only, never in the release).
 *
 * Input is one MediaPipe Hand Landmarker result per hand: 21 image landmarks (x, y in 0..1 of the
 * un-mirrored camera frame, z relative depth) and, when present, 21 world landmarks in metres
 * around the hand's centre. Output is what IWER's `XRHandInput` takes: a target-ray position and
 * orientation in global space, and a pinch value 0..1. IWER applies its own select thresholds to
 * the pinch (press at 0.9, release at 0.7), so the hysteresis lives there, not here.
 *
 * The model is deliberately simple and is not a stand-in for Quest hand tracking:
 * - left/right and up/down come from where the palm is in the frame;
 * - reach (how far in front of you) comes from how big the palm looks, against a size calibrated
 *   when tracking starts, because a single webcam has no real depth;
 * - the ray points from an estimated shoulder through the hand, the way Quest's system ray does.
 */

export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];
export type Side = 'left' | 'right';

export interface Landmark {
  x: number;
  y: number;
  z: number;
}

export interface WebcamHandConfig {
  /** Metres of hand travel that the full frame height covers. Width follows the frame's aspect. */
  spanY: number;
  /** Where the frame's centre sits relative to the eyes, in metres (negative is below). */
  heightOffset: number;
  /** Reach in metres at the calibrated palm size. */
  reach: number;
  /** Rough distance in metres from the shoulders to the camera; sets how fast reach changes. */
  cameraDistance: number;
  minReach: number;
  maxReach: number;
  /** Shoulder relative to the eyes for the right hand; the left one is mirrored on x. */
  shoulder: Vec3;
  /** World-landmark fingertip gap (metres) at which the pinch reads 1, and at which it reads 0. */
  pinchClosedM: number;
  pinchOpenM: number;
  /** Same, as a fraction of palm length, when only image landmarks are available. */
  pinchClosedRatio: number;
  pinchOpenRatio: number;
}

export const DEFAULT_WEBCAM_HAND_CONFIG: WebcamHandConfig = {
  spanY: 0.6,
  heightOffset: -0.25,
  reach: 0.38,
  cameraDistance: 0.75,
  minReach: 0.15,
  maxReach: 0.7,
  shoulder: [0.17, -0.22, 0.05],
  pinchClosedM: 0.015,
  pinchOpenM: 0.06,
  pinchClosedRatio: 0.2,
  pinchOpenRatio: 0.7,
};

// MediaPipe hand landmark indices.
const WRIST = 0;
const THUMB_TIP = 4;
const INDEX_MCP = 5;
const INDEX_TIP = 8;
const MIDDLE_MCP = 9;
const PINKY_MCP = 17;

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** Image distance in units of frame height (x is scaled by the aspect so both axes match). */
function imageDistance(a: Landmark, b: Landmark, aspect: number): number {
  return Math.hypot((a.x - b.x) * aspect, a.y - b.y);
}

/**
 * Apparent palm size in units of frame height. Takes the larger of palm length and (scaled) palm
 * width so that turning the hand edge-on or tipping it forward shrinks it less.
 */
export function palmSize(lm: readonly Landmark[], aspect: number): number {
  const length = imageDistance(lm[WRIST]!, lm[MIDDLE_MCP]!, aspect);
  const width = imageDistance(lm[INDEX_MCP]!, lm[PINKY_MCP]!, aspect) * 1.25;
  return Math.max(length, width);
}

/** Pinch 0..1 from the thumb-tip to index-tip gap. Prefers world landmarks (metres). */
export function pinchValue(
  lm: readonly Landmark[],
  world: readonly Landmark[] | undefined,
  aspect: number,
  cfg: WebcamHandConfig = DEFAULT_WEBCAM_HAND_CONFIG,
): number {
  if (world && world.length >= 21) {
    const t = world[THUMB_TIP]!;
    const i = world[INDEX_TIP]!;
    const gap = Math.hypot(t.x - i.x, t.y - i.y, t.z - i.z);
    return clamp((cfg.pinchOpenM - gap) / (cfg.pinchOpenM - cfg.pinchClosedM), 0, 1);
  }
  const palm = palmSize(lm, aspect);
  if (palm <= 0) return 0;
  const ratio = imageDistance(lm[THUMB_TIP]!, lm[INDEX_TIP]!, aspect) / palm;
  return clamp((cfg.pinchOpenRatio - ratio) / (cfg.pinchOpenRatio - cfg.pinchClosedRatio), 0, 1);
}

/**
 * Which of your hands MediaPipe saw. Its handedness label assumes a mirrored (selfie) image;
 * webcam frames are not mirrored, so "Left" is your right hand. `swap` flips that if a camera
 * driver already mirrors the frames.
 */
export function sideOf(label: string, swap = false): Side {
  const right = label.toLowerCase() === 'left';
  return right !== swap ? 'right' : 'left';
}

/** Yaw (radians about +Y) of a quaternion's forward (-Z) direction. */
export function yawOf(q: Quat): number {
  const [x, y, z, w] = q;
  const fx = -2 * (x * z + w * y);
  const fz = -(1 - 2 * (x * x + y * y));
  return Math.atan2(-fx, -fz);
}

/** Rotate `v` by `yaw` about +Y into `out`. */
function rotateYaw(out: Vec3, v: Vec3, yaw: number): Vec3 {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const x = v[0];
  const z = v[2];
  out[0] = x * c + z * s;
  out[1] = v[1];
  out[2] = -x * s + z * c;
  return out;
}

/** Shortest rotation taking -Z onto the unit vector `d`. */
export function quatFromForward(d: Vec3): Quat {
  const r = 1 - d[2]; // 1 + dot((0,0,-1), d)
  if (r < 1e-6) return [0, 1, 0, 0]; // d is +Z: half turn about Y
  const q: Quat = [d[1], -d[0], 0, r];
  const n = Math.hypot(q[0], q[1], q[2], q[3]);
  return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
}

export interface HeadPose {
  position: Vec3;
  yaw: number;
}

export interface HandTarget {
  position: Vec3;
  quaternion: Quat;
  pinch: number;
}

/** Reach in metres from apparent palm size against the calibrated size (perspective: size ∝ 1/distance). */
export function reachFromPalm(palm: number, refPalm: number, cfg: WebcamHandConfig = DEFAULT_WEBCAM_HAND_CONFIG): number {
  if (!(palm > 0) || !(refPalm > 0)) return cfg.reach;
  const reach = cfg.cameraDistance - (cfg.cameraDistance - cfg.reach) * (refPalm / palm);
  return clamp(reach, cfg.minReach, cfg.maxReach);
}

/** Global-space hand target for one tracked hand. */
export function handTarget(
  lm: readonly Landmark[],
  world: readonly Landmark[] | undefined,
  aspect: number,
  side: Side,
  head: HeadPose,
  refPalm: number,
  cfg: WebcamHandConfig = DEFAULT_WEBCAM_HAND_CONFIG,
): HandTarget {
  // Palm centre in the frame.
  const px = (lm[WRIST]!.x + lm[INDEX_MCP]!.x + lm[MIDDLE_MCP]!.x + lm[PINKY_MCP]!.x) / 4;
  const py = (lm[WRIST]!.y + lm[INDEX_MCP]!.y + lm[MIDDLE_MCP]!.y + lm[PINKY_MCP]!.y) / 4;
  // The frame is un-mirrored: your right hand shows on the image's left (small x).
  const local: Vec3 = [
    (0.5 - px) * cfg.spanY * aspect,
    (0.5 - py) * cfg.spanY + cfg.heightOffset,
    -reachFromPalm(palmSize(lm, aspect), refPalm, cfg),
  ];
  const offset = rotateYaw([0, 0, 0], local, head.yaw);
  const position: Vec3 = [head.position[0] + offset[0], head.position[1] + offset[1], head.position[2] + offset[2]];

  const sh = rotateYaw([0, 0, 0], [side === 'right' ? cfg.shoulder[0] : -cfg.shoulder[0], cfg.shoulder[1], cfg.shoulder[2]], head.yaw);
  const d: Vec3 = [offset[0] - sh[0], offset[1] - sh[1], offset[2] - sh[2]];
  const n = Math.hypot(d[0], d[1], d[2]) || 1;
  const quaternion = quatFromForward([d[0] / n, d[1] / n, d[2] / n]);

  return { position, quaternion, pinch: pinchValue(lm, world, aspect, cfg) };
}

/**
 * Exponential smoothing for one hand. Position is smoothed and the ray re-derived from it by the
 * caller each sample; pinch is smoothed more lightly so selects are not delayed.
 */
export class HandSmoother {
  private pos: Vec3 | null = null;
  private quat: Quat | null = null;
  private pinch = 0;

  constructor(
    private readonly posAlpha = 0.5,
    private readonly pinchAlpha = 0.7,
  ) {}

  reset(): void {
    this.pos = null;
    this.quat = null;
    this.pinch = 0;
  }

  push(t: HandTarget): HandTarget {
    if (!this.pos || !this.quat) {
      this.pos = [...t.position];
      this.quat = [...t.quaternion];
      this.pinch = t.pinch;
    } else {
      const a = this.posAlpha;
      for (let i = 0; i < 3; i++) this.pos[i] = this.pos[i]! + (t.position[i]! - this.pos[i]!) * a;
      // Normalised lerp, taking the short way round.
      const dot = this.quat[0] * t.quaternion[0] + this.quat[1] * t.quaternion[1] + this.quat[2] * t.quaternion[2] + this.quat[3] * t.quaternion[3];
      const sign = dot < 0 ? -1 : 1;
      for (let i = 0; i < 4; i++) this.quat[i] = this.quat[i]! + (sign * t.quaternion[i]! - this.quat[i]!) * a;
      const n = Math.hypot(this.quat[0], this.quat[1], this.quat[2], this.quat[3]) || 1;
      for (let i = 0; i < 4; i++) this.quat[i] = this.quat[i]! / n;
      this.pinch += (t.pinch - this.pinch) * this.pinchAlpha;
    }
    return { position: this.pos, quaternion: this.quat, pinch: clamp(this.pinch, 0, 1) };
  }
}

/** Running average of the first `samples` palm sizes seen for one hand: the reach calibration. */
export class PalmCalibration {
  private sum = 0;
  private count = 0;

  constructor(private readonly samples = 10) {}

  reset(): void {
    this.sum = 0;
    this.count = 0;
  }

  /** Feed a palm size; returns the reference size (the running average until it settles). */
  push(palm: number): number {
    if (this.count < this.samples && palm > 0) {
      this.sum += palm;
      this.count++;
    }
    return this.count > 0 ? this.sum / this.count : palm;
  }
}
