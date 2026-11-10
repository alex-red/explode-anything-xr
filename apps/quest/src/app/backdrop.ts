import { Mesh, SphereGeometry, Vector3, type Camera, type ShaderMaterial, type World } from '@iwsdk/core';
import { backdropMaterial } from './holo.ts';

export type BackdropMode = 'passthrough' | 'dim' | 'virtual';
const ORDER: BackdropMode[] = ['passthrough', 'dim', 'virtual'];
const OPACITY: Record<BackdropMode, number> = { passthrough: 0, dim: 0.72, virtual: 1 };

/** Passthrough-first with an optional dimmed / virtual backdrop (ADR-0003). */
export class Backdrop {
  mode: BackdropMode = 'passthrough';
  /** False in a session that cannot show the real room (a VR session): the backdrop is then fixed. */
  passthroughAvailable = true;
  private readonly mesh: Mesh<SphereGeometry, ShaderMaterial>;
  private readonly pos = new Vector3();

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
    this.mesh.material.uniforms.uOpacity!.value = OPACITY[mode];
    this.mesh.visible = mode !== 'passthrough';
    return mode;
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

  update(camera: Camera): void {
    if (this.mesh.visible) this.mesh.position.copy(camera.getWorldPosition(this.pos));
  }
}
