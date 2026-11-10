/**
 * Webcam hand tracking → IWER emulated hands: the pure maths (dev-only, never in the release).
 *
 * Input is one MediaPipe Hand Landmarker result per hand: 21 image landmarks (x, y in 0..1 of the
 * un-mirrored camera frame) and, when present, 21 world landmarks in metres around the hand's
 * centre. Output is what IWER's `XRHandInput` takes: a target-ray position and orientation in
 * global space, and a pinch that is either fully on or fully off.
 *
 * The model is a screen pointer, not a stand-in for Quest hand tracking:
 * - Where the palm is in the frame picks a direction from the eyes (frame centre = a little below
 *   straight ahead). The hand is placed along that line of sight and its ray continues along it,
 *   so in the emulator's view the thing behind the hand is the thing a pinch clicks. There is no
 *   depth assumption and no parallax between the hand you see and where its ray lands.
 * - How big the palm looks only sets how far along that line the hand sits (for the two-hand
 *   pull, which measures the distance between the hands).
 * - Pinch is a debounced switch on the thumb-to-index gap relative to hand size.
 * - A click is stabilised: on pinch the pointer rewinds to where it was just before the fingers
 *   started closing and stays frozen for a short click, because the app delivers a press on
 *   release only if the ray stayed on the same target. A long hold, or both hands pinching,
 *   unfreezes it so drags and the two-hand pull follow the hands.
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
  /** Degrees of yaw / pitch that the full frame width / height covers. */
  yawSpanDeg: number;
  pitchSpanDeg: number;
  /** Pitch at the frame's centre, in degrees (negative looks down: the content sits below the eyes). */
  pitchOffsetDeg: number;
  /** Distance of the hand from the eyes, in metres, at the calibrated palm size. */
  reach: number;
  /** Rough distance in metres from you to the camera; sets how fast reach changes with palm size. */
  cameraDistance: number;
  minReach: number;
  maxReach: number;
  /** Thumb-index gap as a fraction of palm length: press below, release above. */
  pinchPress: number;
  pinchRelease: number;
  /** Consecutive samples needed to change the pinch state. */
  pinchDebounce: number;
  /** On pinch, rewind the pointer to where it was this long ago (ms). */
  rewindMs: number;
  /** A one-hand pinch keeps the pointer frozen for at most this long (ms); then it is a drag. */
  clickHoldMs: number;
  /** Pointer smoothing: blend per sample when nearly still, and when moving fast (frame units/sample). */
  smoothSlow: number;
  smoothFast: number;
  smoothFastAt: number;
}

export const DEFAULT_WEBCAM_HAND_CONFIG: WebcamHandConfig = {
  // The toolbar is about 25° left of centre and the content 5-25° below the eyes; with these a
  // hand needs to cover roughly the middle half of the frame.
  yawSpanDeg: 110,
  pitchSpanDeg: 80,
  pitchOffsetDeg: -12,
  reach: 0.4,
  cameraDistance: 0.75,
  minReach: 0.3,
  maxReach: 0.6,
  // Palm length (wrist to middle knuckle) is about 9.5 cm, so: press under about 2.5 cm, release
  // over about 3.2 cm. MediaPipe reads touching fingertips as 1.5-2.5 cm apart.
  pinchPress: 0.26,
  pinchRelease: 0.34,
  pinchDebounce: 2,
  rewindMs: 120,
  clickHoldMs: 600,
  smoothSlow: 0.15,
  smoothFast: 0.8,
  smoothFastAt: 0.04,
};

// MediaPipe hand landmark indices.
const WRIST = 0;
const THUMB_TIP = 4;
const INDEX_MCP = 5;
const INDEX_TIP = 8;
const MIDDLE_MCP = 9;
const PINKY_MCP = 17;

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const RAD = Math.PI / 180;

/** Image distance in units of frame height (x is scaled by the aspect so both axes match). */
function imageDistance(a: Landmark, b: Landmark, aspect: number): number {
  return Math.hypot((a.x - b.x) * aspect, a.y - b.y);
}

function distance3(a: Landmark, b: Landmark): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
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

/** Thumb-tip to index-tip gap in metres from world landmarks, or null without them. */
export function pinchGapM(world: readonly Landmark[] | undefined): number | null {
  if (!world || world.length < 21) return null;
  return distance3(world[THUMB_TIP]!, world[INDEX_TIP]!);
}

/**
 * Thumb-index gap as a fraction of palm length (wrist to middle knuckle): about 0.2 when the
 * fingertips touch, 0.4 or more for a relaxed hand. Uses world landmarks when present (they do
 * not foreshorten), else image landmarks.
 */
export function pinchRatio(lm: readonly Landmark[], world: readonly Landmark[] | undefined, aspect: number): number {
  if (world && world.length >= 21) {
    const palm = distance3(world[WRIST]!, world[MIDDLE_MCP]!);
    return palm > 0 ? distance3(world[THUMB_TIP]!, world[INDEX_TIP]!) / palm : 1;
  }
  const palm = imageDistance(lm[WRIST]!, lm[MIDDLE_MCP]!, aspect);
  return palm > 0 ? imageDistance(lm[THUMB_TIP]!, lm[INDEX_TIP]!, aspect) / palm : 1;
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

/**
 * Palm centre as pointer coordinates: u to your right, v up, both 0 at the frame centre and
 * ±0.5 at its edges. The frame is un-mirrored, so your right is the image's left.
 */
export function palmPointer(lm: readonly Landmark[]): { u: number; v: number } {
  const px = (lm[WRIST]!.x + lm[INDEX_MCP]!.x + lm[MIDDLE_MCP]!.x + lm[PINKY_MCP]!.x) / 4;
  const py = (lm[WRIST]!.y + lm[INDEX_MCP]!.y + lm[MIDDLE_MCP]!.y + lm[PINKY_MCP]!.y) / 4;
  return { u: 0.5 - px, v: 0.5 - py };
}

/** Reach in metres from apparent palm size against the calibrated size (perspective: size ∝ 1/distance). */
export function reachFromPalm(palm: number, refPalm: number, cfg: WebcamHandConfig = DEFAULT_WEBCAM_HAND_CONFIG): number {
  if (!(palm > 0) || !(refPalm > 0)) return cfg.reach;
  const reach = cfg.cameraDistance - (cfg.cameraDistance - cfg.reach) * (refPalm / palm);
  return clamp(reach, cfg.minReach, cfg.maxReach);
}

function multiply(a: Quat, b: Quat): Quat {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

/** Rotate `v` by the unit quaternion `q`. */
export function rotate(q: Quat, v: Vec3): Vec3 {
  const [x, y, z, w] = q;
  const tx = 2 * (y * v[2] - z * v[1]);
  const ty = 2 * (z * v[0] - x * v[2]);
  const tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
}

export interface HeadPose {
  position: Vec3;
  quaternion: Quat;
}

export interface HandPose {
  position: Vec3;
  quaternion: Quat;
}

/** Pointer coordinates → yaw to your right and pitch up, in radians, relative to the head. */
export function pointerAngles(u: number, v: number, cfg: WebcamHandConfig = DEFAULT_WEBCAM_HAND_CONFIG): { yaw: number; pitch: number } {
  return { yaw: u * cfg.yawSpanDeg * RAD, pitch: clamp(v * cfg.pitchSpanDeg + cfg.pitchOffsetDeg, -85, 85) * RAD };
}

/** The inverse of `pointerAngles`: the pointer coordinates that aim along a head-space direction. */
export function pointerFor(dirInHead: Vec3, cfg: WebcamHandConfig = DEFAULT_WEBCAM_HAND_CONFIG): { u: number; v: number } {
  const yaw = Math.atan2(dirInHead[0], -dirInHead[2]);
  const pitch = Math.atan2(dirInHead[1], Math.hypot(dirInHead[0], dirInHead[2]));
  return { u: yaw / RAD / cfg.yawSpanDeg, v: (pitch / RAD - cfg.pitchOffsetDeg) / cfg.pitchSpanDeg };
}

/**
 * The emulated hand for a pointer position: on the line of sight in that direction, `reach`
 * metres from the eyes, with its ray (-Z) continuing along the same line.
 */
export function pointerPose(u: number, v: number, reach: number, head: HeadPose, cfg: WebcamHandConfig = DEFAULT_WEBCAM_HAND_CONFIG): HandPose {
  const { yaw, pitch } = pointerAngles(u, v, cfg);
  // Turn right by `yaw` about +Y (a negative rotation), then tip up by `pitch` about +X.
  const local = multiply([0, -Math.sin(yaw / 2), 0, Math.cos(yaw / 2)], [Math.sin(pitch / 2), 0, 0, Math.cos(pitch / 2)]);
  const quaternion = multiply(head.quaternion, local);
  const dir = rotate(quaternion, [0, 0, -1]);
  return {
    position: [head.position[0] + dir[0] * reach, head.position[1] + dir[1] * reach, head.position[2] + dir[2] * reach],
    quaternion,
  };
}

/** Smooths the pointer: heavily when it is nearly still (precision), lightly when it moves fast. */
export class PointerFilter {
  private u = 0;
  private v = 0;
  private primed = false;

  private readonly cfg: WebcamHandConfig;

  constructor(cfg: WebcamHandConfig = DEFAULT_WEBCAM_HAND_CONFIG) {
    this.cfg = cfg;
  }

  reset(): void {
    this.primed = false;
  }

  push(u: number, v: number): { u: number; v: number } {
    if (!this.primed) {
      this.u = u;
      this.v = v;
      this.primed = true;
    } else {
      const { smoothSlow, smoothFast, smoothFastAt } = this.cfg;
      const speed = Math.hypot(u - this.u, v - this.v);
      const a = smoothSlow + (smoothFast - smoothSlow) * clamp(speed / smoothFastAt, 0, 1);
      this.u += (u - this.u) * a;
      this.v += (v - this.v) * a;
    }
    return { u: this.u, v: this.v };
  }
}

/** Pinch as a switch: separate press and release levels, each held for a few samples. */
export class PinchDetector {
  private pinched = false;
  private streak = 0;

  private readonly cfg: WebcamHandConfig;

  constructor(cfg: WebcamHandConfig = DEFAULT_WEBCAM_HAND_CONFIG) {
    this.cfg = cfg;
  }

  reset(): void {
    this.pinched = false;
    this.streak = 0;
  }

  push(ratio: number): boolean {
    const wantsChange = this.pinched ? ratio > this.cfg.pinchRelease : ratio < this.cfg.pinchPress;
    this.streak = wantsChange ? this.streak + 1 : 0;
    if (this.streak >= this.cfg.pinchDebounce) {
      this.pinched = !this.pinched;
      this.streak = 0;
    }
    return this.pinched;
  }
}

/**
 * Keeps a click on its target. Feed it the (smoothed) pointer and the pinch switch for each
 * sample; it returns the pointer to use and the pinch to send.
 *
 * - On pinch: the pointer rewinds to where it was `rewindMs` ago and freezes. The pinch is sent
 *   one sample later, so the ray is already back on target when the select starts.
 * - While frozen: a release ends the click on the same spot. After `clickHoldMs`, or as soon as
 *   the other hand is pinching too, the pointer follows the hand again (a drag or two-hand pull).
 * - On release the frozen pointer is kept for one more sample, so the select ends on target.
 */
export class ClickStabilizer {
  private history: Array<{ t: number; u: number; v: number }> = [];
  private frozen: { u: number; v: number } | null = null;
  private pressedAt = 0;
  private wasPinched = false;
  private sent = false;

  private readonly cfg: WebcamHandConfig;

  constructor(cfg: WebcamHandConfig = DEFAULT_WEBCAM_HAND_CONFIG) {
    this.cfg = cfg;
  }

  reset(): void {
    this.history.length = 0;
    this.frozen = null;
    this.wasPinched = false;
    this.sent = false;
  }

  push(t: number, u: number, v: number, pinched: boolean, otherPinched: boolean): { u: number; v: number; pinch: boolean } {
    let out = { u, v };
    if (pinched && !this.wasPinched) {
      // Rising edge: rewind to the newest sample at least `rewindMs` old (or the oldest we have).
      let past = this.history[0] ?? { t, u, v };
      for (const h of this.history) if (h.t <= t - this.cfg.rewindMs) past = h;
      this.frozen = { u: past.u, v: past.v };
      this.pressedAt = t;
      this.sent = false;
      out = this.frozen;
    } else if (pinched) {
      this.sent = true;
      if (this.frozen && (otherPinched || t - this.pressedAt > this.cfg.clickHoldMs)) this.frozen = null;
      if (this.frozen) out = this.frozen;
    } else {
      if (this.wasPinched && this.frozen) out = this.frozen; // the release lands on the frozen spot
      this.frozen = null;
      this.sent = false;
    }
    this.wasPinched = pinched;

    this.history.push({ t, u, v });
    while (this.history.length > 0 && this.history[0]!.t < t - 2 * this.cfg.rewindMs - 100) this.history.shift();
    return { u: out.u, v: out.v, pinch: pinched && this.sent };
  }
}

/** Running average of the first `samples` palm sizes seen for one hand: the reach calibration. */
export class PalmCalibration {
  private sum = 0;
  private count = 0;

  private readonly samples: number;

  constructor(samples = 10) {
    this.samples = samples;
  }

  reset(): void {
    this.sum = 0;
    this.count = 0;
  }

  /** True once enough samples have been averaged. */
  get settled(): boolean {
    return this.count >= this.samples;
  }

  /** Use a saved reference size, as if it had just been measured. */
  seed(refPalm: number): void {
    if (!(refPalm > 0)) return;
    this.sum = refPalm * this.samples;
    this.count = this.samples;
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
