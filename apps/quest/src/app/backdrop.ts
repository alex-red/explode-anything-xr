import { BackSide, Mesh, MeshBasicMaterial, SphereGeometry, Vector3, type Camera, type World } from '@iwsdk/core';

export type BackdropMode = 'passthrough' | 'dim' | 'virtual';
const ORDER: BackdropMode[] = ['passthrough', 'dim', 'virtual'];
const OPACITY: Record<BackdropMode, number> = { passthrough: 0, dim: 0.72, virtual: 1 };

/** Passthrough-first with an optional dimmed / virtual backdrop (ADR-0003). */
export class Backdrop {
  mode: BackdropMode = 'passthrough';
  private readonly mesh: Mesh<SphereGeometry, MeshBasicMaterial>;
  private readonly pos = new Vector3();

  constructor(world: World) {
    this.mesh = new Mesh(
      new SphereGeometry(4, 24, 16),
      new MeshBasicMaterial({ color: 0x0a1120, side: BackSide, transparent: true, opacity: 0, depthWrite: false }),
    );
    this.mesh.renderOrder = -10;
    this.mesh.visible = false;
    world.createTransformEntity(this.mesh);
  }

  cycle(): BackdropMode {
    this.mode = ORDER[(ORDER.indexOf(this.mode) + 1) % ORDER.length]!;
    this.mesh.material.opacity = OPACITY[this.mode];
    this.mesh.visible = this.mode !== 'passthrough';
    return this.mode;
  }

  update(camera: Camera): void {
    if (this.mesh.visible) this.mesh.position.copy(camera.getWorldPosition(this.pos));
  }
}
