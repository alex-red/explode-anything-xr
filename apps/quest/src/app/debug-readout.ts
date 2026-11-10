import type { Entity, World } from '@iwsdk/core';
import { TextPanel, type TextLine } from './text.ts';

const REFRESH_S = 0.5;
const BUDGET_MS = 1000 / 72;

/**
 * In-world performance readout for device testing (docs/FINAL_PLAN.md A8, gate G2).
 * Off unless the page URL has `?debug` or D is pressed. Repaints twice a second; the per-frame
 * path only adds numbers.
 */
export class DebugReadout {
  private readonly panel: TextPanel;
  private readonly lines: TextLine[] = [
    { text: '', size: 44, bold: true, mono: true },
    { text: '', size: 30, mono: true },
    { text: '', size: 30, mono: true },
    { text: '', size: 30, mono: true },
  ];
  private frames = 0;
  private elapsed = 0;
  private worst = 0;
  private slow = 0;

  constructor(
    private readonly world: World,
    parent: Entity,
  ) {
    this.panel = new TextPanel({ width: 0.24, height: 0.09, pxPerMeter: 2400, padding: 14, radius: 16 });
    this.panel.mesh.position.set(0, -0.2, 0.14);
    this.panel.mesh.rotation.x = -0.5;
    this.panel.mesh.visible = false;
    world.createTransformEntity(this.panel.mesh, { parent });
  }

  get enabled(): boolean {
    return this.panel.mesh.visible;
  }

  set enabled(on: boolean) {
    this.panel.mesh.visible = on;
    this.frames = this.elapsed = this.worst = this.slow = 0;
  }

  /** `dt` is the real frame delta in seconds, not the clamped one used for animation. */
  update(dt: number): void {
    if (!this.panel.mesh.visible) return;
    this.frames++;
    this.elapsed += dt;
    const ms = dt * 1000;
    if (ms > this.worst) this.worst = ms;
    if (ms > BUDGET_MS * 1.5) this.slow++; // a frame that missed the 72 Hz deadline
    if (this.elapsed < REFRESH_S) return;

    // renderer.info describes the last rendered frame; in a session that covers both eyes.
    const info = this.world.renderer.info;
    this.lines[0]!.text = `${(this.frames / this.elapsed).toFixed(0)} fps`;
    this.lines[1]!.text = `worst ${this.worst.toFixed(1)} ms  slow ${this.slow}/${this.frames}`;
    this.lines[2]!.text = info ? `draws ${info.render.calls}  tris ${info.render.triangles}` : 'renderer info unavailable';
    this.lines[3]!.text = info ? `geoms ${info.memory.geometries}  textures ${info.memory.textures}` : '';
    this.panel.draw(this.lines);
    this.frames = this.elapsed = this.worst = this.slow = 0;
  }
}
