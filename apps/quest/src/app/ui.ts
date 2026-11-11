import { Group, Vector3, type Entity, type World } from '@iwsdk/core';
import type { Evidence, SceneState, TruthStatus } from '@explode/contracts';
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
  tutor: { say: string; status: TruthStatus; source: 'live' | 'scripted' } | null;
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
const GUIDE_Y = -0.27;
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
} as const;

/**
 * Spatial UI: control panel (left), caption panel (top), evidence panel (right).
 * Everything sits within the seated reach budget and the 60°×50° cone (ADR-0014).
 */
export class SpatialUI {
  readonly group = new Group();
  private readonly buttons: Array<{ def: ButtonDef; panel: TextPanel; hovered: boolean; hidden: boolean; entity: Entity }> = [];
  private readonly caption: TextPanel;
  private readonly evidence: TextPanel;
  private readonly evidenceClose: TextPanel;
  private readonly controls = new Group();
  private readonly evidenceGroup = new Group();
  private readonly guide: TextPanel;
  private guideDrawn = false;
  private controlsHalfHeight = 0;
  private mode: LayoutMode = 'wide';
  private floor: number | null = null;
  private readonly eye = DEFAULT_EYE.clone();
  /** True when something a panel shows may have changed; render() is skipped otherwise. */
  dirty = true;

  constructor(world: World, parent: Entity, defs: ButtonDef[], onCloseEvidence: () => void) {
    const groupEntity = world.createTransformEntity(this.group, { parent });

    // Controls: two columns, tilted toward the user, lower-left.
    const controlsEntity = world.createTransformEntity(this.controls, { parent: groupEntity });
    defs.forEach((def) => {
      const panel = new TextPanel({ width: BTN_W, height: BTN_H, pxPerMeter: PPM, padding: 10, radius: 22, align: 'center' });
      const entry = { def, panel, hovered: false, hidden: false, entity: null as unknown as Entity };
      entry.entity = makeInteractive(world, panel.mesh, controlsEntity, {
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

    // Gesture guide: a wide card below the model, tipped up toward the eyes, hidden until asked
    // for (the Gestures button). It sits just under the lowest parts and left of the sandbox tray.
    this.guide = new TextPanel({ width: GUIDE_W, height: GUIDE_H, pxPerMeter: PPM, padding: 24, radius: 24 });
    this.guide.mesh.visible = false;
    world.createTransformEntity(this.guide.mesh, { parent: groupEntity });

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

  /** Where the eye is in the anchor's frame, measured at each recenter; the narrow layout aims from it. */
  setEye(eye: Vector3): void {
    this.eye.copy(eye);
    this.applyLayout();
  }

  /** Lay the buttons out on a grid of `cols` columns, showing only those `show` accepts. */
  private layoutButtons(cols: number, show: (id: string) => boolean): void {
    const shown = this.buttons.filter((b) => show(b.def.id));
    const rows = Math.ceil(shown.length / cols);
    this.controlsHalfHeight = (rows * BTN_H + (rows - 1) * GAP) / 2;
    for (const b of this.buttons) {
      b.hidden = !show(b.def.id);
      b.panel.mesh.visible = !b.hidden;
      // A hidden mesh still takes ray hits, so it also shrinks to nothing.
      b.panel.mesh.scale.setScalar(b.hidden ? 1e-4 : 1);
    }
    shown.forEach((b, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      b.panel.mesh.position.set((col - (cols - 1) / 2) * (BTN_W + GAP), ((rows - 1) / 2 - row) * (BTN_H + GAP), 0);
    });
  }

  private applyLayout(): void {
    if (this.mode === 'narrow') {
      this.layoutButtons(NARROW_COLUMNS, (id) => NARROW_BUTTONS.has(id));
      placeFacing(this.controls, this.eye, ...NARROW.controls);
      placeFacing(this.caption.mesh, this.eye, ...NARROW.caption);
      placeFacing(this.evidenceGroup, this.eye, ...NARROW.evidence);
      placeFacing(this.guide.mesh, this.eye, ...NARROW.guide);
      this.syncEvidence();
      this.dirty = true;
      return;
    }
    this.layoutButtons(2, () => true);
    this.controls.rotation.order = 'XYZ';
    this.controls.position.set(-0.31, CONTROLS_Y, 0.16);
    this.controls.rotation.set(-0.25, 0.5, 0);
    this.caption.mesh.rotation.order = 'XYZ';
    this.caption.mesh.position.set(0, 0.335, -0.02); // clear of the tallest exploded layout and its labels
    this.caption.mesh.rotation.set(0.12, 0, 0);
    this.evidenceGroup.rotation.order = 'XYZ';
    this.evidenceGroup.position.set(0.43, 0.04, 0.14);
    this.evidenceGroup.rotation.set(0, -0.62, 0);
    this.guide.mesh.rotation.order = 'XYZ';
    this.guide.mesh.rotation.set(GUIDE_TILT, 0, 0);
    this.guide.mesh.position.set(-0.02, GUIDE_Y, 0.17);
    this.syncEvidence();
    if (this.floor !== null) {
      // On a desk nothing may sit below the surface: the toolbar rises so its lowest button
      // clears it, and the gesture card lies on the desk tipped up toward the eyes.
      const reach = this.controlsHalfHeight * Math.cos(this.controls.rotation.x);
      this.controls.position.y = Math.max(CONTROLS_Y, this.floor + reach + FLOOR_MARGIN);
      this.guide.mesh.rotation.x = GUIDE_DESK_TILT;
      // A card tipped back by the tilt rises |cos(tilt)| × half its height above its centre.
      this.guide.mesh.position.set(-0.02, this.floor + (GUIDE_H / 2) * Math.abs(Math.cos(GUIDE_DESK_TILT)) + FLOOR_MARGIN, 0.2);
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

  /** Lowest point of the toolbar and the gesture card, in the anchor's frame (tests). */
  lowestPanelY(): number {
    const c = this.controls.position.y - this.controlsHalfHeight * Math.cos(this.controls.rotation.x);
    const g = this.guide.mesh.position.y - (GUIDE_H / 2) * Math.abs(Math.cos(this.guide.mesh.rotation.x));
    return Math.min(c, g);
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
    return out;
  }

  render(model: CaptionModel, evidence: Evidence | null): void {
    this.dirty = false;
    for (const b of this.buttons) {
      if (b.hidden) continue; // not drawn, not scaled: stays shrunk out of reach
      const enabled = b.def.enabled();
      const primary = enabled && (b.def.primary?.() ?? false);
      const bg = !enabled ? CSS.buttonDisabled : primary ? CSS.buttonPrimary : b.hovered ? CSS.buttonHover : CSS.buttonBg;
      b.panel.draw([{ text: b.def.label(), size: 38, bold: true, color: enabled ? CSS.text : '#6d7886' }], bg);
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
      lines.push({ text: `${model.tutor.source === 'live' ? 'Tutor (live AI)' : 'Guide (offline)'} · ${b.glyph} ${b.label}`, size: SMALL, color: b.color, bold: true });
      lines.push({ text: model.tutor.say, size: 38 });
    }
    if (model.note) lines.push({ text: model.note, size: SMALL, color: CSS.muted });
    this.caption.draw(lines);

    this.evidenceShown = evidence !== null;
    this.syncEvidence();
    if (evidence) this.evidence.draw(evidenceLines(evidence));
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
  ['Drag empty space', 'turn and tilt it'],
  ['Both hands, pull apart', 'explode, then zoom in'],
  ['Both hands, push together', 'zoom out, then collapse'],
  ['Both hands, push away or pull closer', 'tilt it'],
  ['Both hands, turn like a wheel', 'roll it'],
  ['Recenter', 'put everything back'],
];
const GUIDE_LINES: TextLine[] = [
  { text: 'HAND GESTURES', size: CODE, color: CSS.muted, bold: true, gap: 8 },
  ...GUIDE.map(([gesture, effect]): TextLine => ({ text: `${gesture}  →  ${effect}`, size: SMALL })),
];

function evidenceLines(ev: Evidence): TextLine[] {
  const badge = TRUTH_BADGE[ev.truth_status];
  const lines: TextLine[] = [
    { text: 'EVIDENCE', size: CODE, color: CSS.muted, bold: true },
    { text: ev.title, size: 40, bold: true, gap: 4 },
    { text: `${badge.glyph} ${badge.label}`, size: SMALL, color: badge.color, bold: true, gap: 10 },
  ];
  switch (ev.kind) {
    case 'source_range':
      // The revision is a content hash of the sample's source tree, not a git commit; say so.
      lines.push({ text: `${ev.source.path}:${ev.source.start_line}-${ev.source.end_line} @ tree ${ev.source.revision.slice(0, 12)}`, size: CODE, color: CSS.action, mono: true, gap: 10 });
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

export function consequenceText(state: SceneState, labelOf: (id: string) => string): CaptionModel['consequence'] {
  const c = state.consequences[0];
  if (!c) return null;
  const first = c.first_affected_id ? labelOf(c.first_affected_id) : 'downstream parts';
  const text =
    c.truth_status === 'observed'
      ? `${first} and ${c.affected_ids.length - 1} more stop. A recorded test run shows the tests fail without this connection.`
      : c.truth_status === 'authored_model'
        ? `${first} and everything after it stop receiving power in this teaching model.`
        : `${first} would likely be affected. No recorded test confirms it.`;
  return { status: c.truth_status, text };
}
