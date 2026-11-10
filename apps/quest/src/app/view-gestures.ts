/**
 * Hand gestures for handling the model, as a pure state machine (ADR-0021). No three.js, no XR:
 * `hand-gestures.ts` feeds it each hand's pinch state and position (in the anchor's space: x to
 * the viewer's right, y up, z toward the viewer) and applies the pose it produces.
 *
 * - One hand, pinch and drag: move the model. A pinch that does not travel stays a click.
 * - Two hands, pinch: one continuous "spread" from the change in hand distance. 0..1 is the
 *   explode factor (25 cm of travel, as before); past fully exploded the same pull zooms in.
 *   Pushing together zooms out first, then collapses.
 * - Two hands, twist: turn the model about the vertical axis.
 * - Two hands, move: carry the model. Zoom and turn happen about the model's own centre.
 *
 * Nothing here allocates per update.
 */

export interface ViewPose {
  x: number;
  y: number;
  z: number;
  /** Radians about +Y. */
  yaw: number;
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
  /** Hand-distance change for a full explode, and for the same step of zoom beyond it (m). */
  spreadTravel: number;
  /** Zoom gained per unit of spread past fully exploded. */
  zoomRate: number;
  maxZoom: number;
  /** Twist is ignored below this, so an explode pull does not also turn the model (rad). */
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

export type GestureMode = 'idle' | 'pan' | 'two';

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

type Side = 'left' | 'right';

export class ViewGestures {
  /** Where the model should be. The caller eases the real transform toward it. */
  readonly pose: ViewPose = { x: 0, y: 0, z: 0, yaw: 0, zoom: 1 };
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
  private dist0 = 0;
  private angle0 = 0;
  private twist = 0;
  private lastDist = 0;
  private spread0 = 0;
  private factor0 = 0;
  private factor = 0;

  constructor(cfg: GestureConfig = DEFAULT_GESTURE_CONFIG) {
    this.cfg = cfg;
  }

  /** Back to the authored placement. */
  reset(): void {
    this.pose.x = this.pose.y = this.pose.z = this.pose.yaw = 0;
    this.pose.zoom = 1;
    if (this.mode === 'pan') this.mode = 'idle'; // a live two-hand gesture re-bases itself below
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

  /**
   * Advance one frame.
   * @param factor the committed explode factor (0..1)
   * @param dragBlocked a pinch is pending on a toolbar button, so a one-hand drag must not start
   */
  update(now: number, left: HandInput, right: HandInput, factor: number, dragBlocked: boolean): void {
    this.commit = null;
    this.trackOrigin('left', left);
    this.trackOrigin('right', right);
    const both = left.pinching && right.pinching;

    if (this.mode === 'two') {
      if (!both) this.endTwo();
      else this.updateTwo(left, right);
    }
    if (this.mode === 'pan') {
      const h = this.panHand === 'left' ? left : right;
      if (both) this.startTwo(left, right, factor); // the other hand joined: carry on with two
      else if (!h.pinching) this.mode = 'idle';
      else {
        this.pose.x = clamp(this.px0 + (h.x - this.gx) * this.cfg.panGain, this.cfg.minX, this.cfg.maxX);
        this.pose.y = clamp(this.py0 + (h.y - this.gy) * this.cfg.panGain, this.cfg.minY, this.cfg.maxY);
        this.pose.z = clamp(this.pz0 + (h.z - this.gz) * this.cfg.panGain, this.cfg.minZ, this.cfg.maxZ);
      }
    }
    if (this.mode === 'idle') {
      // Both pinches must start close together; a held pinch plus a later one is two separate presses.
      if (both && Math.abs(left.startedAt - right.startedAt) <= this.cfg.pairWindowMs) this.startTwo(left, right, factor);
      else if (!dragBlocked) {
        if (this.dragged('left', left)) this.startPan('left', left);
        else if (this.dragged('right', right)) this.startPan('right', right);
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

  private startPan(side: Side, h: HandInput): void {
    this.mode = 'pan';
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
    this.lastDist = this.dist0;
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
    const weight = clamp((Math.min(dist, this.lastDist) - c.twistMinDist) / c.twistMinDist, 0, 1);
    this.twist += wrapAngle(angle - this.angle0) * weight;
    this.angle0 = angle;
    this.lastDist = dist;
    const turned = Math.sign(this.twist) * Math.max(0, Math.abs(this.twist) - c.twistDeadzone);

    // Zoom and turn happen about the model's own centre: the hands are always nearer than the
    // model, so a pivot between them would throw it away. Moving both hands carries it.
    this.pose.x = clamp(this.px0 + ((left.x + right.x) / 2 - this.gx) * c.panGain, c.minX, c.maxX);
    this.pose.y = clamp(this.py0 + ((left.y + right.y) / 2 - this.gy) * c.panGain, c.minY, c.maxY);
    this.pose.z = clamp(this.pz0 + ((left.z + right.z) / 2 - this.gz) * c.panGain, c.minZ, c.maxZ);
    this.pose.yaw = wrapAngle(this.yaw0 + turned);
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
