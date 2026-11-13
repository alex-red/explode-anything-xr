import { Group, Vector3, type Entity, type Object3D, type World } from '@iwsdk/core';
import { makeInteractive } from './interactions.ts';
import { CSS } from './palette.ts';
import { TextPanel } from './text.ts';

/** One option in a part's menu. The app decides which apply; the menu only shows and presses them. */
export interface MenuItem {
  id: string;
  label: string;
  onPress: () => void;
}

const PPM = 2800;
const W = 0.16;
const HEAD_H = 0.05;
const ROW_H = 0.032;
const GAP = 0.004;
/** Most options a part ever offers; rows past the items are hidden and out of a ray's reach. */
export const MAX_MENU_ITEMS = 6;
/** m from the part's centre to the menu's near edge, beyond the part itself. */
const CLEARANCE = 0.035;
/** m toward the viewer, so the menu is the first thing a ray meets. */
const FORWARD = 0.05;
/** A part this far right of centre gets its menu on its left, keeping the menu over the model. */
const FLIP_X = 0.12;

/**
 * A context menu that opens beside the selected part: its name, then what can be done with it
 * (explain it, what depends on it, its evidence, …). It lives on the anchor, not the model, so
 * turning or zooming the model never turns the text away; it follows the part and faces the eye.
 * Drawn over everything, like the panels you open to read.
 */
export class NodeMenu {
  readonly group = new Group();
  private readonly header: TextPanel;
  private readonly rows: Array<{ panel: TextPanel; hovered: boolean }> = [];
  private items: MenuItem[] = [];
  private target: string | null = null;
  private dirty = false;
  private title: [string, string] = ['', ''];
  private readonly tmp = new Vector3();

  constructor(world: World, parent: Entity) {
    const entity = world.createTransformEntity(this.group, { parent });
    this.header = new TextPanel({ width: W, height: HEAD_H, pxPerMeter: PPM, padding: 10, radius: 20 });
    world.createTransformEntity(this.header.mesh, { parent: entity });
    for (let i = 0; i < MAX_MENU_ITEMS; i++) {
      const panel = new TextPanel({ width: W, height: ROW_H, pxPerMeter: PPM, padding: 8, radius: 16, align: 'center' });
      const row = { panel, hovered: false };
      makeInteractive(world, panel.mesh, entity, {
        press: () => {
          const item = this.target !== null ? this.items[i] : undefined;
          if (item) item.onPress();
        },
        hover: (on) => {
          row.hovered = on;
          this.dirty = true;
        },
        ui: true,
      });
      this.rows.push(row);
    }
    for (const [p, order] of [[this.header, 22], ...this.rows.map((r) => [r.panel, 23] as const)] as const) {
      p.mesh.material.depthTest = false;
      p.mesh.renderOrder = order;
    }
    this.hide();
  }

  /** The part the menu is open for, or null. */
  get openFor(): string | null {
    return this.target;
  }

  /** Labels of the shown options, in order (tests and the walkthrough). */
  get labels(): string[] {
    return this.items.map((i) => i.label);
  }

  /** Open (or refresh) the menu for `target`: a name, a kind line, and up to six options. */
  open(target: string, name: string, kind: string, items: MenuItem[]): void {
    this.target = target;
    this.items = items.slice(0, MAX_MENU_ITEMS);
    this.title = [name, kind];
    this.group.visible = true;
    this.group.scale.setScalar(1);
    const n = this.items.length;
    const height = HEAD_H + n * (ROW_H + GAP);
    let y = height / 2 - HEAD_H / 2;
    this.header.mesh.position.set(0, y, 0);
    y -= HEAD_H / 2 + GAP + ROW_H / 2;
    this.rows.forEach((r, i) => {
      const shown = i < n;
      r.panel.mesh.visible = shown;
      r.panel.mesh.scale.setScalar(shown ? 1 : 1e-4); // rays hit invisible objects
      if (!shown) r.hovered = false;
      r.panel.mesh.position.set(0, y - i * (ROW_H + GAP), 0.001);
    });
    this.header.draw([
      { text: name, size: 36, bold: true, gap: 2 },
      { text: kind, size: 30, color: CSS.muted },
    ]);
    this.dirty = true;
  }

  hide(): void {
    this.target = null;
    this.items = [];
    this.group.visible = false;
    this.group.scale.setScalar(1e-4); // and out of a ray's reach
    for (const r of this.rows) r.hovered = false;
  }

  /**
   * Follow the part. `partWorld` is its world position, `radius` how far it reaches (m, as drawn),
   * `eye` the eye in the anchor's frame. No allocation.
   */
  update(anchor: Object3D, partWorld: Vector3, radius: number, eye: Vector3): void {
    if (this.target === null) return;
    const p = anchor.worldToLocal(this.tmp.copy(partWorld));
    const side = p.x > FLIP_X ? -1 : 1;
    const x = p.x + side * (radius + CLEARANCE + W / 2);
    const z = p.z + FORWARD;
    this.group.position.set(x, p.y, z);
    this.group.rotation.set(0, Math.atan2(eye.x - x, eye.z - z), 0);
    if (this.dirty) this.redraw();
  }

  private redraw(): void {
    this.dirty = false;
    this.rows.forEach((r, i) => {
      const item = this.items[i];
      if (!item) return;
      r.panel.draw([{ text: item.label, size: 32, bold: true }], r.hovered ? CSS.buttonHover : CSS.buttonBg);
      r.panel.mesh.scale.setScalar(r.hovered ? 1.04 : 1);
    });
  }
}
