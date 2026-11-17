import { Group, Vector3, type Entity, type World } from '@iwsdk/core';
import type { Evidence, FlowType, SceneState, TruthStatus } from '@explode/contracts';
import { placeFacing, type LayoutMode } from './fov.ts';
import { makeInteractive } from './interactions.ts';
import { CSS, TRUTH_BADGE } from './palette.ts';
import { TextPanel, type TextLine } from './text.ts';

export interface ButtonDef {
  id: string;
  label: () => string;
  enabled: () => boolean;
  primary?: () => boolean;
  onPress: () => void;
}

export interface CaptionModel {
  title: string;
  progress: string;
  caption: string;
  question: string | null;
  feedback: string | null;
  annotation: string | null;
  tutor: { say: string; status: TruthStatus; source: 'live' | 'scripted'; model?: string | null } | null;
  note: string | null;
  consequence: { status: TruthStatus; text: string } | null;
}

const PPM = 2800;
const BTN_W = 0.108;
const BTN_H = 0.034;
const GAP = 0.006;
const GUIDE_W = 0.38;
const GUIDE_H = 0.166;
const CONTROLS_Y = -0.06;
const GUIDE_Y = -0.25;
const PLATE_Y = -0.222;
const DOCK_Y = -0.268;
const GUIDE_TILT = -0.45;
/** On a desk the gesture card lies mostly flat, tipped about 30° up toward the eyes. */
const GUIDE_DESK_TILT = -1.05;
/** m every panel keeps above a real surface. */
const FLOOR_MARGIN = 0.012;
const EVIDENCE_W = 0.36;
const EVIDENCE_H = 0.3;
// Text sizes are px at PPM. At the 0.7 m anchor distance 1° of visual angle is about 12 mm,
// which is 34 px here. Nothing a learner has to read is smaller than CODE (0.9°); the headset
// cannot be checked, so sizes err large (docs/FINAL_PLAN.md B3).
const SMALL = 34;
const CODE = 32;
const CODE_LINES = 8;
/** The buttons a lesson needs; the narrow layout shows only these (docs/WIN_PLAN.md W7). */
const NARROW_BUTTONS = new Set(['next', 'explode', 'trace', 'evidence', 'hint', 'undo', 'recenter', 'layout']);
const NARROW_COLUMNS = 4;
/**
 * Wide layout: the buttons a lesson is worked with stand in one column left of the model; these,
 * which set up the session and are pressed rarely, form a strip above the caption. Two columns
 * at the left stood in front of the open model's leftmost group.
 */
const SETTINGS_BUTTONS = new Set(['reset', 'recenter', 'guide', 'sound', 'layout', 'backdrop', 'switch', 'more', 'projects', 'live', 'options']);
const SETTINGS_COLUMNS = 6;
/** m: the settings strip's bottom edge; the strip grows upward from it as Options opens it. */
const SETTINGS_BOTTOM = 0.441;
/**
 * Wide layout, folded (docs/DEMO_PLAN.md B1): about thirty buttons stood around the model at once.
 * The settings strip shows only these until Options opens it, and the view dock only its Move
 * toggle. Explain and What depends are asked from the selected part's own menu (node-menu.ts),
 * so the lesson column leaves them out. Every button stays reachable, by its fold or the menu,
 * and the assistant presses any of them by id.
 */
const SETTINGS_FOLDED = new Set(['recenter', 'switch', 'options']);
const DOCK_FOLDED = new Set(['view-tools']);
const MENU_ONLY = new Set(['explain', 'depends']);

/** The toggle that unfolds a button in the wide layout, or null when it is always out. */
export function foldOf(id: string): 'options' | 'view-tools' | null {
  if (SETTINGS_BUTTONS.has(id) && !SETTINGS_FOLDED.has(id)) return 'options';
  if (DOCK_BUTTONS.has(id) && !DOCK_FOLDED.has(id)) return 'view-tools';
  return null;
}
/**
 * The view dock: a row of buttons centred under the model's front rim that move the model the
 * way the hand gestures do, for anyone who would rather press than pull. Grouped in pairs, with
 * Home view on its own at the end. Wide layout only: the narrow one has no room below the model.
 */
const DOCK_GROUPS: ReadonlyArray<readonly string[]> = [
  ['spread-in', 'spread-out'],
  ['turn-left', 'turn-right'],
  ['tilt-up', 'tilt-down'],
  ['raise', 'lower'],
  ['zoom-out', 'zoom-in'],
  ['home-view'],
  ['view-tools'],
];
const DOCK_BUTTONS = new Set(DOCK_GROUPS.flat());
const DOCK_W = 0.05;
const DOCK_H = 0.03;
const DOCK_GAP = 0.004;
const DOCK_GROUP_GAP = 0.012;
const DOCK_TILT = -0.6;
/** The nameplate: what is on the stage, front and centre, just in front of its rim. */
const PLATE_W = 0.34;
const PLATE_H = 0.054;
const PLATE_TILT = -0.45;
/** On a desk the plate and the dock lie back on the surface like the gesture card. */
const DESK_TILT = -1.05;
/** Where the eye is assumed to be, in the anchor's frame, until the app reports it (floating placement). */
const DEFAULT_EYE = new Vector3(0, 0.14, 0.7);
/**
 * Narrow layout, as [right°, up°, distance m] from the eye around its gaze at the model. Each
 * panel's angular half-size plus its offset stays inside FOV_BUDGET.narrow (tested).
 */
const NARROW = {
  controls: [0, -26, 0.45],
  caption: [0, 23, 0.75],
  evidence: [16, -1, 0.6], // between the caption above and the toolbar strip below, its Close button clear of both
  guide: [-12, 0, 0.5],
  plate: [0, -19.2, 0.72], // in the gap between the evidence panel and the toolbar strip
} as const;

/**
 * Spatial UI: lesson controls (left), caption panel (top) with the settings strip above it,
 * evidence panel (right), and the nameplate over the view dock (front, under the model).
 * Everything sits within the seated reach budget and the 60°×50° cone (ADR-0014).
 */
export class SpatialUI {
  readonly group = new Group();
  private readonly buttons: Array<{ def: ButtonDef; panel: TextPanel; hovered: boolean; hidden: boolean; entity: Entity }> = [];
  private readonly caption: TextPanel;
  private readonly evidence: TextPanel;
  private readonly evidenceClose: TextPanel;
  private readonly controls = new Group();
  /** The settings strip. In the narrow layout it shares the toolbar's place, and the two form one grid. */
  private readonly settings = new Group();
  private readonly evidenceGroup = new Group();
  private readonly guide: TextPanel;
  /** Nameplate and view dock, centred in front of the stage. */
  private readonly dock = new Group();
  private readonly plate: TextPanel;
  private plateText: [string, string] = ['', ''];
  private plateHovered = false;
  private revisionKind: 'git' | 'content_hash' = 'content_hash';
  private guideDrawn = false;
  private controlsHalfHeight = 0;
  private mode: LayoutMode = 'wide';
  private settingsOpen = false;
  private dockOpen = false;
  private floor: number | null = null;
  private readonly eye = DEFAULT_EYE.clone();
  /** True when something a panel shows may have changed; render() is skipped otherwise. */
  dirty = true;

  constructor(world: World, parent: Entity, defs: ButtonDef[], onCloseEvidence: () => void, onPlatePressed: () => void = () => {}) {
    const groupEntity = world.createTransformEntity(this.group, { parent });

    // Controls: one column, tilted toward the user, at the left; settings: a strip above the caption.
    const controlsEntity = world.createTransformEntity(this.controls, { parent: groupEntity });
    const settingsEntity = world.createTransformEntity(this.settings, { parent: groupEntity });
    const dockEntity = world.createTransformEntity(this.dock, { parent: groupEntity });
    defs.forEach((def) => {
      const docked = DOCK_BUTTONS.has(def.id);
      const panel = docked
        ? new TextPanel({ width: DOCK_W, height: DOCK_H, pxPerMeter: PPM, padding: 6, radius: 18, align: 'center' })
        : new TextPanel({ width: BTN_W, height: BTN_H, pxPerMeter: PPM, padding: 10, radius: 22, align: 'center' });
      const entry = { def, panel, hovered: false, hidden: false, entity: null as unknown as Entity };
      entry.entity = makeInteractive(world, panel.mesh, docked ? dockEntity : SETTINGS_BUTTONS.has(def.id) ? settingsEntity : controlsEntity, {
        press: () => {
          if (entry.hidden) return; // not in this layout: a ray can still reach the hidden mesh
          if (def.enabled()) def.onPress();
          this.dirty = true;
        },
        hover: (on) => {
          entry.hovered = on;
          this.dirty = true;
        },
        ui: true,
      });
      this.buttons.push(entry);
    });

    // Gesture guide: a wide card low on the right, tipped up toward the eyes, hidden until asked
    // for (the Gestures button). The nameplate and the view dock have the place under the model.
    this.guide = new TextPanel({ width: GUIDE_W, height: GUIDE_H, pxPerMeter: PPM, padding: 24, radius: 24 });
    this.guide.mesh.visible = false;
    world.createTransformEntity(this.guide.mesh, { parent: groupEntity });

    // Nameplate: what is being exploded, in front of the stage (drawn by setSubject). It is also
    // the project picker's handle: press it to choose another thing to explode.
    this.plate = new TextPanel({ width: PLATE_W, height: PLATE_H, pxPerMeter: PPM, padding: 10, radius: 26, align: 'center' });
    makeInteractive(world, this.plate.mesh, groupEntity, {
      press: onPlatePressed,
      hover: (on) => {
        this.plateHovered = on;
        this.drawPlate();
      },
      ui: true,
    });

    // Captions: above the system.
    this.caption = new TextPanel({ width: 0.52, height: 0.19, pxPerMeter: PPM, padding: 36, radius: 30 });
    world.createTransformEntity(this.caption.mesh, { parent: groupEntity });

    // Evidence: right side, tilted toward the user (positions: applyLayout).
    const evEntity = world.createTransformEntity(this.evidenceGroup, { parent: groupEntity });
    this.evidence = new TextPanel({ width: EVIDENCE_W, height: EVIDENCE_H, pxPerMeter: PPM, padding: 34, radius: 26 });
    world.createTransformEntity(this.evidence.mesh, { parent: evEntity });
    this.evidenceClose = new TextPanel({ width: 0.07, height: 0.03, pxPerMeter: PPM, padding: 8, radius: 20, align: 'center' });
    this.evidenceClose.draw([{ text: 'Close', size: 40, bold: true }], CSS.buttonBg);
    this.evidenceClose.mesh.position.set(EVIDENCE_W / 2 - 0.045, -EVIDENCE_H / 2 - 0.022, 0.002);
    makeInteractive(world, this.evidenceClose.mesh, evEntity, { press: onCloseEvidence, ui: true });
    this.evidenceGroup.visible = false;
    // Panels you open to read draw over the model: in the narrow layout they sit across it, and
    // parts at the same depth would otherwise cut through the text.
    for (const [panel, order] of [
      [this.guide, 20],
      [this.evidence, 20],
      [this.evidenceClose, 21],
    ] as const) {
      panel.mesh.material.depthTest = false;
      panel.mesh.renderOrder = order;
    }
    this.applyLayout();
  }

  get layout(): LayoutMode {
    return this.mode;
  }

  /** Switch between the wide (Quest 3S) and narrow (glasses-class) layouts. */
  setLayout(mode: LayoutMode): void {
    this.mode = mode;
    this.applyLayout();
  }

  /** Hide the caption panel while something modal stands where it would be read (the project picker). */
  set captionHidden(hidden: boolean) {
    this.caption.mesh.visible = !hidden;
  }

  /** True while Options has the whole settings strip out. */
  get optionsOpen(): boolean {
    return this.settingsOpen;
  }

  /** True while Move has the whole view dock out. */
  get viewToolsOpen(): boolean {
    return this.dockOpen;
  }

  /** Options: show the whole settings strip, or fold it back to Recenter, the tutorial switch and itself. */
  toggleOptions(): void {
    this.settingsOpen = !this.settingsOpen;
    this.applyLayout();
  }

  /** Move: show the whole view dock, or fold it back to itself. */
  toggleViewTools(): void {
    this.dockOpen = !this.dockOpen;
    this.applyLayout();
  }

  /** Wide layout: whether a button stands out now, given the folds (SETTINGS_FOLDED, DOCK_FOLDED, MENU_ONLY). */
  private shownWide(id: string): boolean {
    if (MENU_ONLY.has(id)) return false;
    if (SETTINGS_BUTTONS.has(id)) return this.settingsOpen || SETTINGS_FOLDED.has(id);
    if (DOCK_BUTTONS.has(id)) return this.dockOpen || DOCK_FOLDED.has(id);
    return true;
  }

  /** Where the eye is in the anchor's frame, measured at each recenter; the narrow layout aims from it. */
  setEye(eye: Vector3): void {
    this.eye.copy(eye);
    this.applyLayout();
  }

  /** Show only the buttons `show` accepts; the rest are hidden and out of a ray's reach. */
  private showButtons(show: (id: string) => boolean): void {
    for (const b of this.buttons) {
      b.hidden = !show(b.def.id);
      b.panel.mesh.visible = !b.hidden;
      // A hidden mesh still takes ray hits, so it also shrinks to nothing.
      b.panel.mesh.scale.setScalar(b.hidden ? 1e-4 : 1);
    }
  }

  /** Lay the shown buttons `pick` accepts out on a grid of `cols` columns. Returns the grid's half height. */
  private layoutGrid(cols: number, pick: (id: string) => boolean): number {
    const shown = this.buttons.filter((b) => !b.hidden && pick(b.def.id));
    const rows = Math.ceil(shown.length / cols);
    shown.forEach((b, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      b.panel.mesh.position.set((col - (cols - 1) / 2) * (BTN_W + GAP), ((rows - 1) / 2 - row) * (BTN_H + GAP), 0);
    });
    return (rows * BTN_H + (rows - 1) * GAP) / 2;
  }

  private applyLayout(): void {
    if (this.mode === 'narrow') {
      // One strip of the lesson's buttons: both groups stand in the same place and share its grid.
      this.showButtons((id) => NARROW_BUTTONS.has(id));
      this.controlsHalfHeight = this.layoutGrid(NARROW_COLUMNS, () => true);
      placeFacing(this.controls, this.eye, ...NARROW.controls);
      placeFacing(this.settings, this.eye, ...NARROW.controls);
      placeFacing(this.caption.mesh, this.eye, ...NARROW.caption);
      placeFacing(this.evidenceGroup, this.eye, ...NARROW.evidence);
      placeFacing(this.guide.mesh, this.eye, ...NARROW.guide);
      placeFacing(this.plate.mesh, this.eye, ...NARROW.plate);
      this.syncEvidence();
      this.dirty = true;
      return;
    }
    this.showButtons((id) => this.shownWide(id));
    this.controlsHalfHeight = this.layoutGrid(1, (id) => !SETTINGS_BUTTONS.has(id) && !DOCK_BUTTONS.has(id));
    this.layoutDock();
    const settingsHalfHeight = this.layoutGrid(SETTINGS_COLUMNS, (id) => SETTINGS_BUTTONS.has(id));
    // The column's inner edge is about 32° left of the gaze, just outside the open model's reach
    // (31°), and its outer edge about 41°, inside the wide budget (fov.ts).
    this.controls.rotation.order = 'XYZ';
    this.controls.position.set(-0.4, CONTROLS_Y, 0.16);
    this.controls.rotation.set(-0.25, 0.5, 0);
    this.caption.mesh.rotation.order = 'XYZ';
    this.caption.mesh.position.set(0, 0.335, -0.02); // above the tallest exploded layout; part labels keep below it (graph-view LABEL_CEILING)
    this.caption.mesh.rotation.set(0.12, 0, 0);
    this.settings.rotation.order = 'XYZ';
    // Bottom-aligned, so opening Options adds rows above and never over the caption.
    this.settings.position.set(0, SETTINGS_BOTTOM + settingsHalfHeight, -0.03);
    this.settings.rotation.set(0.2, 0, 0);
    this.evidenceGroup.rotation.order = 'XYZ';
    this.evidenceGroup.position.set(0.43, 0.04, 0.14);
    this.evidenceGroup.rotation.set(0, -0.62, 0);
    // The gesture card opens low on the right, beside the dock, turned toward the eyes.
    this.guide.mesh.rotation.order = 'YXZ';
    this.guide.mesh.rotation.set(GUIDE_TILT, -0.6, 0);
    this.guide.mesh.position.set(0.47, GUIDE_Y, 0.15);
    // Nameplate just in front of the stage's rim; the dock below and nearer, tipped up to the eyes.
    this.plate.mesh.rotation.order = 'XYZ';
    this.plate.mesh.rotation.set(PLATE_TILT, 0, 0);
    this.plate.mesh.position.set(0, PLATE_Y, 0.275);
    this.dock.rotation.order = 'XYZ';
    this.dock.rotation.set(DOCK_TILT, 0, 0);
    this.dock.position.set(0, DOCK_Y, 0.295);
    this.syncEvidence();
    if (this.floor !== null) {
      // On a desk nothing may sit below the surface: the toolbar rises so its lowest button
      // clears it, and the gesture card lies on the desk tipped up toward the eyes.
      const reach = this.controlsHalfHeight * Math.cos(this.controls.rotation.x);
      this.controls.position.y = Math.max(CONTROLS_Y, this.floor + reach + FLOOR_MARGIN);
      this.guide.mesh.rotation.x = GUIDE_DESK_TILT;
      // A card tipped back by the tilt rises |cos(tilt)| × half its height above its centre.
      this.guide.mesh.position.set(0.44, this.floor + (GUIDE_H / 2) * Math.abs(Math.cos(GUIDE_DESK_TILT)) + FLOOR_MARGIN, 0.2);
      this.plate.mesh.rotation.x = DESK_TILT;
      this.plate.mesh.position.set(0, this.floor + (PLATE_H / 2) * Math.abs(Math.cos(DESK_TILT)) + FLOOR_MARGIN, 0.28);
      this.dock.rotation.x = DESK_TILT;
      this.dock.position.set(0, this.floor + (DOCK_H / 2) * Math.abs(Math.cos(DESK_TILT)) + FLOOR_MARGIN, 0.335);
    }
    this.dirty = true;
  }

  /**
   * Keep panels above a real surface at local height `floor` (the desk under the stage), or
   * restore the floating layout with `null`. On a desk the toolbar rises so its lowest button
   * clears the surface, and the gesture card lies on the desk tipped up toward the eyes.
   */
  setFloor(floor: number | null): void {
    this.floor = floor;
    this.applyLayout();
  }

  /** Lowest point of the toolbar, the gesture card, the nameplate and the dock, in the anchor's frame (tests). */
  lowestPanelY(): number {
    const c = this.controls.position.y - this.controlsHalfHeight * Math.cos(this.controls.rotation.x);
    const g = this.guide.mesh.position.y - (GUIDE_H / 2) * Math.abs(Math.cos(this.guide.mesh.rotation.x));
    const p = this.plate.mesh.position.y - (PLATE_H / 2) * Math.abs(Math.cos(this.plate.mesh.rotation.x));
    const d = this.dock.position.y - (DOCK_H / 2) * Math.abs(Math.cos(this.dock.rotation.x));
    return this.mode === 'narrow' ? Math.min(c, g, p) : Math.min(c, g, p, d);
  }

  /** The dock's shown buttons in one row, centred, a wider gap between pairs. */
  private layoutDock(): void {
    const byId = new Map(this.buttons.map((b) => [b.def.id, b]));
    const groups = DOCK_GROUPS.map((ids) => ids.map((id) => byId.get(id)).filter((b): b is NonNullable<typeof b> => b !== undefined && !b.hidden)).filter((g) => g.length > 0);
    const width = groups.reduce((w, g) => w + g.length * DOCK_W + (g.length - 1) * DOCK_GAP, 0) + (groups.length - 1) * DOCK_GROUP_GAP;
    let x = -width / 2;
    for (const g of groups) {
      for (const b of g) {
        b.panel.mesh.position.set(x + DOCK_W / 2, 0, 0);
        x += DOCK_W + DOCK_GAP;
      }
      x += DOCK_GROUP_GAP - DOCK_GAP;
    }
  }

  /**
   * Name what is on the stage: a small kind line ("TEACHING MODEL", "CODEBASE · …") over the
   * system's name. Drawn only when it changes.
   */
  setSubject(kind: string, name: string): void {
    if (kind === this.plateText[0] && name === this.plateText[1]) return;
    this.plateText = [kind, name];
    this.drawPlate();
  }

  private drawPlate(): void {
    const [kind, name] = this.plateText;
    this.plate.draw(
      [
        { text: kind, size: 28, color: CSS.action, bold: true, gap: 2 },
        { text: `${name}  ▾`, size: 50, bold: true },
      ],
      this.plateHovered ? CSS.buttonHover : undefined,
    );
    this.plate.mesh.scale.setScalar(this.plateHovered ? 1.03 : 1);
  }

  get guideVisible(): boolean {
    return this.guide.mesh.visible;
  }

  /** Show or hide the gesture guide. It is drawn the first time it is shown and never changes. */
  toggleGuide(): void {
    if (!this.guideDrawn) {
      this.guideDrawn = true;
      this.guide.draw(GUIDE_LINES);
    }
    this.guide.mesh.visible = !this.guide.mesh.visible;
    this.syncEvidence();
    this.dirty = true;
  }

  /** World position of every toolbar button by id (debug and the emulator walkthrough). */
  buttonPositions(tmp: Vector3): Record<string, number[]> {
    const out: Record<string, number[]> = {};
    for (const b of this.buttons) out[b.def.id] = b.panel.mesh.getWorldPosition(tmp).toArray();
    out.nameplate = this.plate.mesh.getWorldPosition(tmp).toArray();
    return out;
  }

  render(model: CaptionModel, evidence: Evidence | null, revision: 'git' | 'content_hash' = 'content_hash'): void {
    this.revisionKind = revision;
    this.dirty = false;
    for (const b of this.buttons) {
      if (b.hidden) continue; // not drawn, not scaled: stays shrunk out of reach
      const enabled = b.def.enabled();
      const primary = enabled && (b.def.primary?.() ?? false);
      const bg = !enabled ? CSS.buttonDisabled : primary ? CSS.buttonPrimary : b.hovered ? CSS.buttonHover : CSS.buttonBg;
      b.panel.draw([{ text: b.def.label(), size: DOCK_BUTTONS.has(b.def.id) ? 30 : 38, bold: true, color: enabled ? CSS.text : '#6d7886' }], bg);
      b.panel.mesh.scale.setScalar(b.hovered && enabled ? 1.05 : 1);
    }

    const lines: TextLine[] = [{ text: `${model.title}   ${model.progress}`, size: 34, color: CSS.muted, gap: 6 }];
    lines.push({ text: model.caption, size: 46, bold: true, gap: 10 });
    if (model.question) lines.push({ text: model.question, size: 40, color: CSS.path, gap: 8 });
    if (model.annotation) lines.push({ text: model.annotation, size: 36, color: CSS.muted, gap: 6 });
    if (model.feedback) lines.push({ text: model.feedback, size: 40, color: CSS.action, gap: 8 });
    if (model.consequence) {
      const b = TRUTH_BADGE[model.consequence.status];
      lines.push({ text: `${b.glyph} ${b.label}`, size: SMALL, color: b.color, bold: true });
      lines.push({ text: model.consequence.text, size: 36, color: CSS.text, gap: 8 });
    }
    if (model.tutor) {
      const b = TRUTH_BADGE[model.tutor.status];
      // A live answer names the model it came from, as the proxy reported it (EXPLORE_PLAN W12).
      const who = model.tutor.source === 'live' ? (model.tutor.model ? `Tutor (live AI · ${model.tutor.model.slice(0, 32)})` : 'Tutor (live AI)') : 'Guide (offline)';
      lines.push({ text: `${who} · ${b.glyph} ${b.label}`, size: SMALL, color: b.color, bold: true });
      lines.push({ text: model.tutor.say, size: 38 });
    }
    if (model.note) lines.push({ text: model.note, size: SMALL, color: CSS.muted });
    this.caption.draw(lines);

    this.evidenceShown = evidence !== null;
    this.syncEvidence();
    if (evidence) this.evidence.draw(evidenceLines(evidence, this.revisionKind));
  }

  private evidenceShown = false;

  /**
   * Show the evidence panel when it is open, except that in the narrow layout the gesture card
   * takes its place while shown (the two do not fit side by side). Hidden, it also shrinks to
   * nothing: rays hit invisible objects, and its Close button must not be pressable then.
   */
  private syncEvidence(): void {
    const show = this.evidenceShown && !(this.mode === 'narrow' && this.guide.mesh.visible);
    this.evidenceGroup.visible = show;
    this.evidenceGroup.scale.setScalar(show ? 1 : 1e-4);
  }
}

/**
 * The gesture guide: what the hands do, in the fewest words (ADR-0021). One line per gesture.
 */
const GUIDE: ReadonlyArray<readonly [gesture: string, effect: string]> = [
  ['Pinch', 'select a part, press a button'],
  ['Drag a part', 'move the model'],
  ['Drag empty space sideways', 'spin it'],
  ['Drag empty space up or down', 'tilt it'],
  ['Flick empty space sideways', 'fewer or more code parts'],
  ['Both hands, pull apart', 'explode, then zoom in'],
  ['Both hands, push together', 'zoom out, then collapse'],
  ['Both hands, push away or pull closer', 'tilt it'],
  ['Both hands, one forward, one back', 'spin it'],
  ['Both hands, turn like a wheel', 'roll it'],
  ['Recenter', 'put everything back'],
];
const GUIDE_LINES: TextLine[] = [
  { text: 'HAND GESTURES', size: CODE, color: CSS.muted, bold: true, gap: 8 },
  ...GUIDE.map(([gesture, effect]): TextLine => ({ text: `${gesture}  →  ${effect}`, size: SMALL })),
];

function evidenceLines(ev: Evidence, revision: 'git' | 'content_hash'): TextLine[] {
  const badge = TRUTH_BADGE[ev.truth_status];
  const lines: TextLine[] = [
    { text: 'EVIDENCE', size: CODE, color: CSS.muted, bold: true },
    { text: ev.title, size: 40, bold: true, gap: 4 },
    { text: `${badge.glyph} ${badge.label}`, size: SMALL, color: badge.color, bold: true, gap: 10 },
  ];
  switch (ev.kind) {
    case 'source_range':
      // Say what the revision is: a git commit for a real repository, a content hash of the source tree for the sample.
      lines.push({ text: `${ev.source.path}:${ev.source.start_line}-${ev.source.end_line} @ ${revision === 'git' ? 'commit' : 'tree'} ${ev.source.revision.slice(0, 12)}`, size: CODE, color: CSS.action, mono: true, gap: 10 });
      for (const l of ev.source.excerpt.split('\n').slice(0, CODE_LINES)) lines.push({ text: l || ' ', size: CODE, mono: true });
      break;
    case 'test_run':
      lines.push({ text: `Recorded at build time: ${ev.run.recorded_at}`, size: CODE, color: CSS.muted });
      lines.push({ text: `$ ${ev.run.command}`, size: CODE, mono: true, color: CSS.action });
      lines.push({ text: `${ev.run.passed} passed · ${ev.run.failed} failed · ${ev.executed_node_ids.length} graph nodes executed`, size: SMALL, gap: 8 });
      if (ev.summary) lines.push({ text: ev.summary, size: CODE, color: CSS.muted });
      break;
    case 'mutation_run':
      lines.push({ text: `Recorded at build time on a copy. The real repository was not modified.`, size: CODE, color: CSS.muted });
      lines.push({ text: ev.mutation.description, size: SMALL, gap: 6 });
      for (const l of ev.mutation.diff.split('\n').slice(0, 4)) lines.push({ text: l, size: CODE, mono: true, color: l.startsWith('-') ? CSS.fault : l.startsWith('+') ? '#7ee081' : CSS.text });
      lines.push({ text: `${ev.run.failed} failing: ${ev.run.failing_tests.slice(0, 3).join(', ')}`, size: CODE, color: CSS.fault, gap: 6 });
      lines.push({ text: `$ ${ev.run.command}`, size: CODE, mono: true, color: CSS.muted });
      break;
    case 'authored_rule':
      lines.push({ text: ev.rule.statement, size: 34, gap: 8 });
      lines.push({ text: `Source: ${ev.rule.model_source}`, size: CODE, color: CSS.muted });
      break;
    case 'asset_license':
      lines.push({ text: `${ev.license.name}: ${ev.license.attribution}`, size: CODE });
      break;
  }
  return lines;
}

/** What a connection carries, as the words "stop receiving …" needs. */
const CARRIES: Record<FlowType, string> = {
  electrical: 'power',
  torque: 'torque',
  data: 'data',
  control: 'control signals',
  heat: 'heat',
  request: 'requests',
};

/**
 * The caption's line about what a cut stops. `flowOf` gives what the cut connection carries
 * (its first flow), so a cut camera link is not said to stop power.
 */
export function consequenceText(state: SceneState, labelOf: (id: string) => string, flowOf: (edgeId: string) => FlowType | undefined = () => undefined): CaptionModel['consequence'] {
  const c = state.consequences[0];
  if (!c) return null;
  const first = c.first_affected_id ? labelOf(c.first_affected_id) : 'downstream parts';
  const flow = flowOf(c.edge_id);
  const text =
    c.truth_status === 'observed'
      ? `${first} and ${c.affected_ids.length - 1} more stop. A recorded test run shows the tests fail without this connection.`
      : c.truth_status === 'authored_model'
        ? `${first} and everything after it stop receiving ${flow ? CARRIES[flow] : 'what this connection carries'} in this teaching model.`
        : `${first} would likely be affected. No recorded test confirms it.`;
  return { status: c.truth_status, text };
}
