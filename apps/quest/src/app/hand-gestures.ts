import { Vector3, type Object3D, type World } from '@iwsdk/core';
import { noteRelease, setInteractionsEnabled, setXrActive, uiPressPending } from './interactions.ts';
import { unstickRayPointer } from './pointer-unstick.ts';
import { ViewGestures, newHandInput, type ViewPose } from './view-gestures.ts';

/**
 * Hand (and controller) gestures for handling the model (ADR-0012, ADR-0021): feeds each hand's
 * pinch state and position to the pure `ViewGestures` state machine and reports what it decides.
 * Pinch is WebXR select, which works for hands and controllers; squeeze counts too. Pose
 * detection is deliberately avoided, and every gesture has a button or key equivalent.
 *
 * - Both hands pinch and pull: explode, then zoom (`onPreview` live, `onCommit` on release).
 * - Both hands twist or move: turn or carry the model.
 * - One hand pinches and drags: move the model. A pinch that does not travel is still a click.
 *
 * While a gesture is live, ray presses are suspended, so a hand that is moving the model never
 * also selects a part or presses a button.
 */
export class HandGestures {
  readonly gestures = new ViewGestures();
  private readonly left = newHandInput();
  private readonly right = newHandInput();
  private session: XRSession | null = null;
  private suspended = false;
  /** Select (pinch or trigger) only, without squeeze: what IWSDK's ray pointer follows. */
  private readonly selecting = { left: false, right: false };
  private readonly v = new Vector3();

  constructor(
    private readonly world: World,
    /** Hand positions are measured in this object's space, and the pose applies in it. */
    private readonly space: Object3D,
    private readonly getFactor: () => number,
    private readonly onPreview: (factor: number | null) => void,
    private readonly onCommit: (factor: number) => void,
  ) {
    setXrActive(false); // no session yet: presses come from the mouse until one starts
    world.renderer.xr.addEventListener('sessionstart', () => this.attach(world.renderer.xr.getSession()));
    world.renderer.xr.addEventListener('sessionend', () => this.detach());
  }

  /** Where the model should be, relative to its authored placement. */
  get pose(): ViewPose {
    return this.gestures.pose;
  }

  get engaged(): boolean {
    return this.gestures.mode !== 'idle';
  }

  update(): void {
    const g = this.gestures;
    if (this.session) {
      this.space.updateWorldMatrix(true, false);
      this.read(this.world.player.gripSpaces.left, this.left);
      this.read(this.world.player.gripSpaces.right, this.right);
    }
    const pointers = (this.world as unknown as { input?: { xr?: { multiPointers?: Record<string, unknown> } } }).input?.xr?.multiPointers;
    if (pointers) {
      const now = performance.now();
      unstickRayPointer(pointers.left, this.selecting.left, now);
      unstickRayPointer(pointers.right, this.selecting.right, now);
    }
    const hadPreview = g.preview !== null;
    g.update(performance.now(), this.left, this.right, this.getFactor(), uiPressPending());
    const live = g.mode !== 'idle';
    if (live !== this.suspended) {
      this.suspended = live;
      setInteractionsEnabled(!live);
    }
    if (g.preview !== null) this.onPreview(g.preview);
    else if (hadPreview) this.onPreview(null);
    if (g.commit !== null) this.onCommit(g.commit);
  }

  private read(grip: Object3D, into: { x: number; y: number; z: number }): void {
    this.space.worldToLocal(grip.getWorldPosition(this.v));
    into.x = this.v.x;
    into.y = this.v.y;
    into.z = this.v.z;
  }

  private attach(session: XRSession | null): void {
    this.detach();
    if (!session) return;
    this.session = session;
    setXrActive(true);
    const set = (on: boolean, select: boolean) => (e: XRInputSourceEvent) => {
      const h = e.inputSource.handedness;
      if (h !== 'left' && h !== 'right') return;
      const hand = h === 'left' ? this.left : this.right;
      hand.pinching = on;
      if (on) hand.startedAt = performance.now();
      else noteRelease();
      if (select) this.selecting[h] = on;
    };
    session.addEventListener('selectstart', set(true, true));
    session.addEventListener('selectend', set(false, true));
    session.addEventListener('squeezestart', set(true, false));
    session.addEventListener('squeezeend', set(false, false));
  }

  private detach(): void {
    this.session = null;
    setXrActive(false);
    this.left.pinching = this.right.pinching = false;
    this.selecting.left = this.selecting.right = false;
    const hadPreview = this.gestures.preview !== null;
    this.gestures.cancel();
    if (this.suspended) {
      this.suspended = false;
      setInteractionsEnabled(true);
    }
    if (hadPreview) this.onPreview(null);
  }
}
