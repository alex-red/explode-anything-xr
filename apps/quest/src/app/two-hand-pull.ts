import { Vector3, type World } from '@iwsdk/core';
import { setInteractionsEnabled } from './interactions.ts';

/**
 * Two-hand pinch-and-pull explode (ADR-0012). Both hands pinch (WebXR select, which works for
 * hands and controllers); pulling apart opens the system, pushing together closes it.
 * Pose detection is deliberately avoided. The Explode button is always the alternative.
 */
export class TwoHandPull {
  private selecting = { left: false, right: false };
  private active = false;
  private startDist = 0;
  private startFactor = 0;
  private value = 0;
  private session: XRSession | null = null;
  private readonly l = new Vector3();
  private readonly r = new Vector3();

  constructor(
    private readonly world: World,
    private readonly getFactor: () => number,
    private readonly onPreview: (factor: number | null) => void,
    private readonly onCommit: (factor: number) => void,
  ) {
    world.renderer.xr.addEventListener('sessionstart', () => this.attach(world.renderer.xr.getSession()));
    world.renderer.xr.addEventListener('sessionend', () => this.detach());
  }

  get engaged(): boolean {
    return this.active;
  }

  update(): void {
    if (!this.session) return;
    const both = this.selecting.left && this.selecting.right;
    this.world.player.gripSpaces.left.getWorldPosition(this.l);
    this.world.player.gripSpaces.right.getWorldPosition(this.r);
    const dist = this.l.distanceTo(this.r);
    if (both && !this.active) {
      this.active = true;
      this.startDist = dist;
      this.startFactor = this.getFactor();
      this.value = this.startFactor;
      setInteractionsEnabled(false);
    }
    if (this.active) {
      if (!both) {
        this.active = false;
        setInteractionsEnabled(true);
        this.onPreview(null);
        const snapped = this.value > 0.85 ? 1 : this.value < 0.15 ? 0 : this.value;
        if (Math.abs(snapped - this.startFactor) > 0.05) this.onCommit(snapped);
        return;
      }
      // 25 cm of hand travel = a full explode.
      this.value = Math.min(1, Math.max(0, this.startFactor + (dist - this.startDist) / 0.25));
      this.onPreview(this.value);
    }
  }

  private attach(session: XRSession | null): void {
    this.detach();
    if (!session) return;
    this.session = session;
    const set = (on: boolean) => (e: XRInputSourceEvent) => {
      const h = e.inputSource.handedness;
      if (h === 'left' || h === 'right') this.selecting[h] = on;
    };
    session.addEventListener('selectstart', set(true));
    session.addEventListener('selectend', set(false));
    session.addEventListener('squeezestart', set(true));
    session.addEventListener('squeezeend', set(false));
  }

  private detach(): void {
    this.session = null;
    this.selecting = { left: false, right: false };
    if (this.active) {
      this.active = false;
      setInteractionsEnabled(true);
      this.onPreview(null);
    }
  }
}
