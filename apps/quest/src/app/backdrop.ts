import { Mesh, SphereGeometry, Vector3, type Camera, type ShaderMaterial, type World } from '@iwsdk/core';
import { backdropMaterial } from './holo.ts';

export type BackdropMode = 'passthrough' | 'dim' | 'virtual';
const ORDER: BackdropMode[] = ['passthrough', 'dim', 'virtual'];
const OPACITY: Record<BackdropMode, number> = { passthrough: 0, dim: 0.72, virtual: 1 };
/** How far the lesson's illustration dims the room: most of it, so the change is unmistakable. */
const ILLUSTRATE_OPACITY = 0.9;
/** 1/s: the backdrop eases to its target over about half a second, so the room never flashes. */
const FADE_RATE = 6;

/** Passthrough-first with an optional dimmed / virtual backdrop (ADR-0003). */
export class Backdrop {
  mode: BackdropMode = 'passthrough';
  /** False in a session that cannot show the real room (a VR session): the backdrop is then fixed. */
  passthroughAvailable = true;
  private readonly mesh: Mesh<SphereGeometry, ShaderMaterial>;
  private readonly pos = new Vector3();
  private illustrating = false;
  private opacity = 0;
  private target = 0;

  constructor(world: World) {
    this.mesh = new Mesh(new SphereGeometry(4, 32, 24), backdropMaterial());
    this.mesh.renderOrder = -10;
    this.mesh.visible = false;
    world.createTransformEntity(this.mesh);
  }

  cycle(): BackdropMode {
    if (!this.passthroughAvailable) return this.mode;
    return this.set(ORDER[(ORDER.indexOf(this.mode) + 1) % ORDER.length]!);
  }

  set(mode: BackdropMode): BackdropMode {
    this.mode = mode;
    this.retarget(true);
    return mode;
  }

  /**
   * The lesson's illustration (WIN_PLAN W3): fade the room most of the way out, or back to the
   * viewer's chosen mode. The mode the viewer picked is kept and shown unchanged on the toggle.
   */
  illustrate(on: boolean): void {
    this.illustrating = on;
    this.retarget(false);
  }

  /** True while the lesson's illustration holds the room dimmed. */
  get illustrated(): boolean {
    return this.illustrating;
  }

  /** The opacity the backdrop is easing to. */
  get targetOpacity(): number {
    return this.target;
  }

  private retarget(snap: boolean): void {
    this.target = Math.max(OPACITY[this.mode], this.illustrating ? ILLUSTRATE_OPACITY : 0);
    if (snap) this.opacity = this.target;
    this.apply();
  }

  private apply(): void {
    this.mesh.material.uniforms.uOpacity!.value = this.opacity;
    this.mesh.visible = this.opacity > 0.001;
  }

  /**
   * Called when a session starts. An opaque session (VR, or AR without passthrough blending)
   * shows black behind the scene, so switch to the virtual backdrop and lock the toggle.
   * A session that blends with the room goes back to passthrough.
   */
  onSessionStart(blendMode: string | undefined): void {
    this.passthroughAvailable = blendMode !== 'opaque';
    this.set(this.passthroughAvailable ? 'passthrough' : 'virtual');
  }

  onSessionEnd(): void {
    this.passthroughAvailable = true;
    this.set('passthrough');
  }

  update(camera: Camera, dt = 0): void {
    if (this.opacity !== this.target) {
      const step = Math.min(1, dt * FADE_RATE);
      this.opacity += (this.target - this.opacity) * step;
      if (Math.abs(this.target - this.opacity) < 0.005) this.opacity = this.target;
      this.apply();
    }
    if (this.mesh.visible) this.mesh.position.copy(camera.getWorldPosition(this.pos));
  }
}
