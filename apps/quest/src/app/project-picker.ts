import { Group, Vector3, type Entity, type World } from '@iwsdk/core';
import { makeInteractive } from './interactions.ts';
import { CSS } from './palette.ts';
import { TextPanel } from './text.ts';

/** One row of the picker. The app fills these in; the picker only shows and presses them. */
export interface PickerItem {
  id: string;
  /** The kind line: "TEACHING MODEL", "CODEBASE". */
  kind: string;
  name: string;
  blurb: string;
  current: boolean;
  done: boolean;
  /** Its bundle is already in hand, so opening it needs no download. */
  loaded: boolean;
  /** Not a project: a row that starts something (Explode anything). Drawn as an action. */
  action?: boolean;
}

const PPM = 2800;
const W = 0.3;
const HEAD_H = 0.042;
const ROW_H = 0.056;
const GAP = 0.005;
/** Most projects the picker lists; rows past the items are hidden and out of a ray's reach. */
export const MAX_PICKER_ITEMS = 8;
/** Rows the list holds before it is raised so its foot stays where a six-row list ends. */
const ROWS_AT_REST = 6;
/** Seconds for one row to drop into place, and between one row and the next. */
const ROW_SECONDS = 0.22;
const STAGGER = 0.045;
const CLOSE_SECONDS = 0.16;
/** Where its header opens, in the anchor's frame: in front of the model, so the list hangs centred on it and under the caption. */
const AT = new Vector3(0, 0.17, 0.2);

const easeOutBack = (t: number) => {
  const c = 1.4;
  const u = t - 1;
  return 1 + (c + 1) * u * u * u + c * u * u;
};

/**
 * The project picker: a drop-down list of every system the app can put on the stage, opened from
 * the nameplate (or the Projects button). Rows unfold one after another under its header, each
 * sliding down out of the one above, and fold back up when it closes. It stands in front of the
 * model and is drawn over everything, like the other panels you open to read.
 */
export class ProjectPicker {
  readonly group = new Group();
  private readonly header: TextPanel;
  private readonly rows: Array<{ panel: TextPanel; hovered: boolean; y: number }> = [];
  private items: PickerItem[] = [];
  private shown = false;
  /** Seconds since it opened, or the close animation's progress (counts down to 0). */
  private clock = 0;
  private closing = 0;
  private dirty = false;
  private lift = 0;

  constructor(
    world: World,
    parent: Entity,
    private readonly onPick: (id: string) => void,
  ) {
    const entity = world.createTransformEntity(this.group, { parent });
    this.header = new TextPanel({ width: W, height: HEAD_H, pxPerMeter: PPM, padding: 10, radius: 20, align: 'center' });
    makeInteractive(world, this.header.mesh, entity, { press: () => this.close(), ui: true });
    for (let i = 0; i < MAX_PICKER_ITEMS; i++) {
      const panel = new TextPanel({ width: W, height: ROW_H, pxPerMeter: PPM, padding: 12, radius: 18 });
      const row = { panel, hovered: false, y: 0 };
      makeInteractive(world, panel.mesh, entity, {
        press: () => {
          const item = this.shown && this.closing === 0 ? this.items[i] : undefined;
          if (!item) return;
          this.close();
          if (!item.current) this.onPick(item.id);
        },
        hover: (on) => {
          row.hovered = on;
          this.dirty = true;
        },
        ui: true,
      });
      this.rows.push(row);
    }
    for (const [p, order] of [[this.header, 24], ...this.rows.map((r) => [r.panel, 25] as const)] as const) {
      p.mesh.material.depthTest = false;
      p.mesh.renderOrder = order;
    }
    this.hideNow();
  }

  get isOpen(): boolean {
    return this.shown && this.closing === 0;
  }

  /** Names of the listed projects, in order (tests and the walkthrough). */
  get names(): string[] {
    return this.isOpen ? this.items.map((i) => i.name) : [];
  }

  /** World position of each listed row by project id, while open (the emulator walkthrough aims from this). */
  rowPositions(tmp: Vector3): Record<string, number[]> {
    const out: Record<string, number[]> = {};
    if (this.isOpen) this.items.forEach((item, i) => { const row = this.rows[i]; if (row) out[item.id] = row.panel.mesh.getWorldPosition(tmp).toArray(); });
    return out;
  }

  open(items: PickerItem[]): void {
    this.items = items.slice(0, MAX_PICKER_ITEMS);
    this.shown = true;
    this.closing = 0;
    this.clock = 0;
    this.group.visible = true;
    this.group.scale.setScalar(1);
    this.header.draw([
      { text: 'CHOOSE WHAT TO EXPLODE   ▴', size: 30, bold: true, color: CSS.action },
    ]);
    let y = -HEAD_H / 2 - GAP - ROW_H / 2;
    // A longer list rises rather than reaching further down toward the desk.
    this.lift = Math.max(0, this.items.length - ROWS_AT_REST) * (ROW_H + GAP);
    this.rows.forEach((r, i) => {
      r.y = y - i * (ROW_H + GAP);
      if (i >= this.items.length) {
        r.panel.mesh.visible = false;
        r.panel.mesh.scale.setScalar(1e-4); // rays hit invisible objects
        r.hovered = false;
      }
    });
    this.dirty = true;
    this.animate();
  }

  close(): void {
    if (!this.shown || this.closing > 0) return;
    this.closing = CLOSE_SECONDS;
    for (const r of this.rows) r.hovered = false;
  }

  toggle(items: () => PickerItem[]): void {
    if (this.isOpen) this.close();
    else this.open(items());
  }

  /** Once a frame: run the unfold or fold, keep it facing the eye. No allocation. */
  update(dt: number, eye: Vector3): void {
    if (!this.shown) return;
    if (this.closing > 0) {
      this.closing = Math.max(0, this.closing - dt);
      if (this.closing === 0) {
        this.hideNow();
        return;
      }
    } else this.clock += dt;
    this.group.position.copy(AT);
    this.group.position.y += this.lift;
    this.group.rotation.set(0, Math.atan2(eye.x - AT.x, eye.z - AT.z), 0);
    if (this.dirty) this.redraw();
    this.animate();
  }

  private animate(): void {
    // Closing folds everything back up into the header at once; opening unfolds row by row.
    const fold = this.closing > 0 ? this.closing / CLOSE_SECONDS : 1;
    const head = this.closing > 0 ? fold : Math.min(1, this.clock / ROW_SECONDS);
    this.header.mesh.position.set(0, 0, 0);
    this.header.mesh.scale.set(1, Math.max(1e-4, easeOutBack(head)), 1);
    this.header.mesh.material.opacity = head;
    this.rows.forEach((r, i) => {
      if (i >= this.items.length) return;
      const t = this.closing > 0 ? fold : Math.min(1, Math.max(0, (this.clock - (i + 1) * STAGGER) / ROW_SECONDS));
      const k = this.closing > 0 ? t * t : easeOutBack(t);
      const m = r.panel.mesh;
      m.visible = t > 0;
      // Each row slides down out of the place above it and swings flat as it lands.
      m.position.set(0, r.y * k, 0.001 + 0.004 * (1 - t));
      m.rotation.x = -(1 - Math.min(1, k)) * 1.2;
      m.material.opacity = t;
      m.scale.setScalar(t <= 0 ? 1e-4 : r.hovered ? 1.03 : 1);
    });
  }

  private redraw(): void {
    this.dirty = false;
    this.rows.forEach((r, i) => {
      const item = this.items[i];
      if (!item) return;
      if (item.action) {
        r.panel.draw(
          [
            { text: item.kind, size: 24, bold: true, color: CSS.path, gap: 2 },
            { text: item.name, size: 38, bold: true, color: CSS.action, gap: 2 },
            { text: item.blurb, size: 26, color: CSS.muted },
          ],
          r.hovered ? CSS.buttonHover : CSS.buttonBg,
        );
        return;
      }
      const mark = item.current ? '●  ON THE STAGE' : item.done ? '✓  DONE' : item.loaded ? '' : '↓  LOADS ON OPEN';
      const kind = mark ? `${item.kind}   ·   ${mark}` : item.kind;
      r.panel.draw(
        [
          { text: kind, size: 24, bold: true, color: item.current ? CSS.path : CSS.action, gap: 2 },
          { text: item.name, size: 38, bold: true, gap: 2 },
          { text: item.blurb, size: 26, color: CSS.muted },
        ],
        item.current ? CSS.buttonPrimary : r.hovered ? CSS.buttonHover : CSS.buttonBg,
      );
    });
  }

  private hideNow(): void {
    this.shown = false;
    this.closing = 0;
    this.group.visible = false;
    this.group.scale.setScalar(1e-4); // and out of a ray's reach
    for (const r of this.rows) {
      r.hovered = false;
      r.panel.mesh.visible = false;
    }
  }
}
