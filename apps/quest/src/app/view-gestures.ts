/**
 * Hand gestures for handling the model, as a pure state machine (ADR-0021). No three.js, no XR:
 * `hand-gestures.ts` feeds it each hand's pinch state and position (in the anchor's space: x to
 * the viewer's right, y up, z toward the viewer) and applies the pose it produces.
 *
 * - One hand, pinch and drag: starting on a part moves the model; starting on empty space turns
 *   it (left/right spins it, up/down tilts it). A pinch that does not travel stays a click.
 * - Two hands, pinch: one continuous "spread" from the change in hand distance. 0..1 is the
 *   explode factor (25 cm of travel, as before); past fully exploded the same pull zooms in.
 *   Pushing together zooms out first, then collapses.
 * - Two hands, rotate: the line between the pinched hands is a handle on the model. Turning it
 *   like a steering wheel rolls the model about the viewer's line of sight; pushing one hand
 *   forward and pulling the other back spins it about the vertical axis.
 * - Two hands, push away or pull closer: tilt the model about the viewer's left-right axis.
 * - Two hands, move sideways or up and down: carry the model. Zoom and turn happen about the
 *   model's own centre.
 *
 * Nothing here allocates per update.
 */

export interface ViewPose {
  x: number;
  y: number;
  z: number;
  /** Radians about +Y. */
  yaw: number;
  /** Tilt: radians about the viewer's left-right axis, applied after the yaw. */
  pitch: number;
  /** Radians about the viewer's line of sight (+Z, toward the viewer), applied last. */
  roll: number;
  /** Uniform scale; 1 is the authored size. */
  zoom: number;
}

export interface GestureConfig {
  /** Both pinches must start within this window to count as a two-hand gesture (ms). */
  pairWindowMs: number;
  /** Hand travel that turns a one-hand pinch into a drag (m). */
  dragStart: number;
  /** Model travel per metre of hand travel. The model is farther away than the hand. */
  panGain: number;
  /** One-hand turn: radians of spin, and of tilt, per metre of hand travel. */
  turnGain: number;
  tiltGain: number;
  /** Tilt stops here either way, so the model cannot be flipped over (rad). */
  maxTilt: number;
  /** Two-hand push/pull: radians of tilt per metre the hands move toward or away from the viewer, */
  pushTiltGain: number;
  /** and the travel that is ignored first, so holding still does not tilt it (m). */
  pushDeadzone: number;
  /** Hand-distance change for a full explode, and for the same step of zoom beyond it (m). */
  spreadTravel: number;
  /** Zoom gained per unit of spread past fully exploded. */
  zoomRate: number;
  maxZoom: number;
  /**
   * Two-hand rotations (spin or wheel turn) well below this are ignored, so an explode pull does
   * not also turn the model; well above it they follow the hands exactly (rad, see `pastDeadzone`).
   */
  twistDeadzone: number;
  /** Twist counts fully once the hands are twice this far apart, and not at all below it (m). */
  twistMinDist: number;
  /** How far the model may be moved from home, per axis (m). */
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

export const DEFAULT_GESTURE_CONFIG: GestureConfig = {
  pairWindowMs: 500,
  dragStart: 0.03,
  panGain: 1.5,
  // 30 cm of sideways travel is about a quarter turn; tilt is gentler.
  turnGain: 5.5,
  tiltGain: 3.5,
  maxTilt: (60 * Math.PI) / 180,
  // 15 cm of push or pull is the whole 60°.
  pushTiltGain: 7,
  pushDeadzone: 0.02,
  spreadTravel: 0.25,
  zoomRate: 1.5,
  maxZoom: 2, // at 2x the exploded software graph already fills the view
  // A straight pull with one hand a few centimetres nearer than the other also changes the
  // bearing between them (by about 10° from 24 cm apart to 50 cm), so a turn has to be deliberate.
  twistDeadzone: (10 * Math.PI) / 180,
  twistMinDist: 0.12,
  minX: -0.45,
  maxX: 0.45,
  minY: -0.3,
  maxY: 0.35,
  // Toward the viewer stops about 0.35 m from the eyes (the anchor is 0.7 m out).
  minZ: -0.5,
  maxZ: 0.35,
};

export type GestureMode = 'idle' | 'pan' | 'turn' | 'two';

/** What a pinch started on: a toolbar or panel control, a part of the model, or nothing. */
export type PinchTarget = 'ui' | 'part' | 'space';

/** One hand's input for a frame. The caller owns and reuses these. */
export interface HandInput {
  pinching: boolean;
  /** When the current pinch started (ms). */
  startedAt: number;
  x: number;
  y: number;
  z: number;
}

export const newHandInput = (): HandInput => ({ pinching: false, startedAt: 0, x: 0, y: 0, z: 0 });

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const wrapAngle = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * A soft deadzone: nothing below 0.6 × `deadzone`, the full angle from 1.8 × `deadzone` up, and a
 * smooth ramp between. Small accidental rotations are ignored, and a deliberate one follows the
 * hands one-to-one instead of trailing them by the deadzone.
 */
export function pastDeadzone(angle: number, deadzone: number): number {
  const t = clamp((Math.abs(angle) - deadzone * 0.6) / (deadzone * 1.2), 0, 1);
  return angle * t * t * (3 - 2 * t);
}

type Side = 'left' | 'right';

export class ViewGestures {
  /** Where the model should be. The caller eases the real transform toward it. */
  readonly pose: ViewPose = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, zoom: 1 };
  mode: GestureMode = 'idle';
  /** While a two-hand gesture is live: the explode factor to preview. Otherwise null. */
  preview: number | null = null;
  /** Set for the one update in which a two-hand gesture ended with a changed factor. */
  commit: number | null = null;

  private readonly cfg: GestureConfig;
  // Where each current pinch started, to measure drag travel.
  // `spent`: this pinch was part of a two-hand gesture, so it cannot go on to drag by itself.
  private readonly origin = {
    left: { x: 0, y: 0, z: 0, set: false, spent: false },
    right: { x: 0, y: 0, z: 0, set: false, spent: false },
  };
  private panHand: Side = 'right';
  // Gesture start state.
  private gx = 0;
  private gy = 0;
  private gz = 0;
  private px0 = 0;
  private py0 = 0;
  private pz0 = 0;
  private yaw0 = 0;
  private pitch0 = 0;
  private roll0 = 0;
  private dist0 = 0;
  private angle0 = 0;
  private twist = 0;
  private lastDist = 0;
  // The same bookkeeping for the wheel turn, measured in the plane facing the viewer.
  private wheelAngle0 = 0;
  private wheel = 0;
  private lastFront = 0;
  private spread0 = 0;
  private factor0 = 0;
  private factor = 0;

  constructor(cfg: GestureConfig = DEFAULT_GESTURE_CONFIG) {
    this.cfg = cfg;
  }

  /** Back to the authored placement. */
  reset(): void {
    this.pose.x = this.pose.y = this.pose.z = this.pose.yaw = this.pose.pitch = this.pose.roll = 0;
    this.pose.zoom = 1;
    if (this.mode === 'pan' || this.mode === 'turn') this.mode = 'idle'; // a live two-hand gesture re-bases itself below
    if (this.mode === 'two') this.rebase = true;
  }

  private rebase = false;

  /** Button and keyboard equivalents. */
  panBy(dx: number, dy: number, dz: number): void {
    this.pose.x = clamp(this.pose.x + dx, this.cfg.minX, this.cfg.maxX);
    this.pose.y = clamp(this.pose.y + dy, this.cfg.minY, this.cfg.maxY);
    this.pose.z = clamp(this.pose.z + dz, this.cfg.minZ, this.cfg.maxZ);
  }

  zoomBy(ratio: number): void {
    this.pose.zoom = clamp(this.pose.zoom * ratio, 1, this.cfg.maxZoom);
  }

  turnBy(radians: number): void {
    this.pose.yaw = wrapAngle(this.pose.yaw + radians);
  }

  rollBy(radians: number): void {
    this.pose.roll = wrapAngle(this.pose.roll + radians);
  }

  tiltBy(radians: number): void {
    this.pose.pitch = clamp(this.pose.pitch + radians, -this.cfg.maxTilt, this.cfg.maxTilt);
  }

  /**
   * Advance one frame.
   * @param factor the committed explode factor (0..1)
   * @param startedOn what the current pinch started on: a control never drags, a part moves the
   *   model, empty space turns it
   */
  update(now: number, left: HandInput, right: HandInput, factor: number, startedOn: PinchTarget): void {
    this.commit = null;
    this.trackOrigin('left', left);
    this.trackOrigin('right', right);
    const both = left.pinching && right.pinching;

    if (this.mode === 'two') {
      if (!both) this.endTwo();
      else this.updateTwo(left, right);
    }
    if (this.mode === 'pan' || this.mode === 'turn') {
      const h = this.panHand === 'left' ? left : right;
      if (both) this.startTwo(left, right, factor); // the other hand joined: carry on with two
      else if (!h.pinching) this.mode = 'idle';
      else if (this.mode === 'turn') {
        // Like turning a globe from the front: dragging right spins the near side to the right,
        // dragging up tips the top away.
        this.pose.yaw = wrapAngle(this.yaw0 + (h.x - this.gx) * this.cfg.turnGain);
        this.pose.pitch = clamp(this.pitch0 - (h.y - this.gy) * this.cfg.tiltGain, -this.cfg.maxTilt, this.cfg.maxTilt);
      } else {
        this.pose.x = clamp(this.px0 + (h.x - this.gx) * this.cfg.panGain, this.cfg.minX, this.cfg.maxX);
        this.pose.y = clamp(this.py0 + (h.y - this.gy) * this.cfg.panGain, this.cfg.minY, this.cfg.maxY);
        this.pose.z = clamp(this.pz0 + (h.z - this.gz) * this.cfg.panGain, this.cfg.minZ, this.cfg.maxZ);
      }
    }
    if (this.mode === 'idle') {
      // Both pinches must start close together; a held pinch plus a later one is two separate presses.
      if (both && Math.abs(left.startedAt - right.startedAt) <= this.cfg.pairWindowMs) this.startTwo(left, right, factor);
      else if (startedOn !== 'ui') {
        if (this.dragged('left', left)) this.startDrag('left', left, startedOn);
        else if (this.dragged('right', right)) this.startDrag('right', right, startedOn);
      }
      // Zoom only exists on a fully opened model: closing it (by button too) returns to full size.
      // (A factor committed this very update has not reached the store yet, so it wins.)
      if (this.mode === 'idle' && (this.commit ?? factor) < 0.999) this.pose.zoom = 1;
    }
  }

  /** Drop any gesture in progress without committing (session ended). */
  cancel(): void {
    this.mode = 'idle';
    this.preview = null;
    this.commit = null;
    this.origin.left.set = this.origin.right.set = false;
    this.origin.left.spent = this.origin.right.spent = false;
  }

  private trackOrigin(side: Side, h: HandInput): void {
    const o = this.origin[side];
    if (!h.pinching) o.set = o.spent = false;
    else if (!o.set) {
      o.x = h.x;
      o.y = h.y;
      o.z = h.z;
      o.set = true;
    }
  }

  private dragged(side: Side, h: HandInput): boolean {
    const o = this.origin[side];
    return h.pinching && o.set && !o.spent && Math.hypot(h.x - o.x, h.y - o.y, h.z - o.z) > this.cfg.dragStart;
  }

  private startDrag(side: Side, h: HandInput, startedOn: PinchTarget): void {
    this.mode = startedOn === 'part' ? 'pan' : 'turn';
    this.yaw0 = this.pose.yaw;
    this.pitch0 = this.pose.pitch;
    this.panHand = side;
    // Grab from where the hand is now, not where the pinch began, so the model does not jump.
    this.gx = h.x;
    this.gy = h.y;
    this.gz = h.z;
    this.px0 = this.pose.x;
    this.py0 = this.pose.y;
    this.pz0 = this.pose.z;
  }

  private startTwo(left: HandInput, right: HandInput, factor: number): void {
    this.mode = 'two';
    // Hands never let go at the same instant: the one still pinching must not start a drag.
    this.origin.left.spent = this.origin.right.spent = true;
    this.factor0 = factor;
    this.factor = factor;
    this.baseTwo(left, right);
    this.preview = factor;
  }

  private baseTwo(left: HandInput, right: HandInput): void {
    this.gx = (left.x + right.x) / 2;
    this.gy = (left.y + right.y) / 2;
    this.gz = (left.z + right.z) / 2;
    this.dist0 = Math.hypot(right.x - left.x, right.y - left.y, right.z - left.z);
    this.angle0 = Math.atan2(-(right.z - left.z), right.x - left.x);
    this.twist = 0;
    this.lastDist = Math.hypot(right.x - left.x, right.z - left.z);
    this.wheelAngle0 = Math.atan2(right.y - left.y, right.x - left.x);
    this.wheel = 0;
    this.lastFront = Math.hypot(right.x - left.x, right.y - left.y);
    this.roll0 = this.pose.roll;
    this.pitch0 = this.pose.pitch;
    this.px0 = this.pose.x;
    this.py0 = this.pose.y;
    this.pz0 = this.pose.z;
    this.yaw0 = this.pose.yaw;
    this.spread0 = this.factor >= 0.999 ? 1 + (this.pose.zoom - 1) / this.cfg.zoomRate : this.factor;
  }

  private updateTwo(left: HandInput, right: HandInput): void {
    const c = this.cfg;
    if (this.rebase) {
      this.rebase = false;
      this.baseTwo(left, right);
    }
    const dist = Math.hypot(right.x - left.x, right.y - left.y, right.z - left.z);
    const maxSpread = 1 + (c.maxZoom - 1) / c.zoomRate;
    const spread = clamp(this.spread0 + (dist - this.dist0) / c.spreadTravel, 0, maxSpread);
    this.factor = Math.min(1, spread);
    this.preview = this.factor;
    const zoom = spread >= maxSpread ? c.maxZoom : spread > 1 ? 1 + (spread - 1) * c.zoomRate : 1;

    // Twist: add up the change in the hands' bearing, counting it only while they are far enough
    // apart for that bearing to mean something (close together, palm offsets swamp it).
    const angle = Math.atan2(-(right.z - left.z), right.x - left.x);
    // Each rotation only trusts the part of the hand separation it can see: the spin uses the
    // separation in the horizontal plane, the wheel turn the separation in the plane facing the
    // viewer. So a big wheel turn (hands one above the other) cannot fake a spin, or the reverse.
    const flat = Math.hypot(right.x - left.x, right.z - left.z);
    const weight = clamp((Math.min(flat, this.lastDist) - c.twistMinDist) / c.twistMinDist, 0, 1);
    this.twist += wrapAngle(angle - this.angle0) * weight;
    this.angle0 = angle;
    this.lastDist = flat;
    const turned = pastDeadzone(this.twist, c.twistDeadzone);

    // Wheel turn: counter-clockwise as the viewer sees it (right hand up, left hand down) is a
    // positive roll about +Z.
    const wheelAngle = Math.atan2(right.y - left.y, right.x - left.x);
    const front = Math.hypot(right.x - left.x, right.y - left.y);
    const wheelWeight = clamp((Math.min(front, this.lastFront) - c.twistMinDist) / c.twistMinDist, 0, 1);
    this.wheel += wrapAngle(wheelAngle - this.wheelAngle0) * wheelWeight;
    this.wheelAngle0 = wheelAngle;
    this.lastFront = front;
    const rolled = pastDeadzone(this.wheel, c.twistDeadzone);

    // Zoom and turn happen about the model's own centre: the hands are always nearer than the
    // model, so a pivot between them would throw it away. Moving both hands carries it.
    this.pose.x = clamp(this.px0 + ((left.x + right.x) / 2 - this.gx) * c.panGain, c.minX, c.maxX);
    this.pose.y = clamp(this.py0 + ((left.y + right.y) / 2 - this.gy) * c.panGain, c.minY, c.maxY);
    // Toward or away from the viewer is not a carry: pulling the hands closer tips the top of the
    // model toward you, pushing them away tips it back (+z is toward the viewer).
    const pushed = pastDeadzone((left.z + right.z) / 2 - this.gz, c.pushDeadzone);
    this.pose.pitch = clamp(this.pitch0 + pushed * c.pushTiltGain, -c.maxTilt, c.maxTilt);
    this.pose.yaw = wrapAngle(this.yaw0 + turned);
    this.pose.roll = wrapAngle(this.roll0 + rolled);
    this.pose.zoom = zoom;
  }

  private endTwo(): void {
    this.mode = 'idle';
    this.preview = null;
    const snapped = this.factor > 0.85 ? 1 : this.factor < 0.15 ? 0 : this.factor;
    if (Math.abs(snapped - this.factor0) > 0.05) this.commit = snapped;
    if (snapped < 0.999) this.pose.zoom = 1;
  }
}
