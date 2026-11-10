import { Group, type Entity, type Vector3, type World } from '@iwsdk/core';
import type { Evidence, SceneState, TruthStatus } from '@explode/contracts';
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

/**
 * Spatial UI: control panel (left), caption panel (top), evidence panel (right).
 * Everything sits within the seated reach budget and the 60°×50° cone (ADR-0014).
 */
export class SpatialUI {
  readonly group = new Group();
  private readonly buttons: Array<{ def: ButtonDef; panel: TextPanel; hovered: boolean; entity: Entity }> = [];
  private readonly caption: TextPanel;
  private readonly evidence: TextPanel;
  private readonly evidenceClose: TextPanel;
  private readonly controls = new Group();
  private readonly evidenceGroup = new Group();
  /** True when something a panel shows may have changed; render() is skipped otherwise. */
  dirty = true;

  constructor(world: World, parent: Entity, defs: ButtonDef[], onCloseEvidence: () => void) {
    const groupEntity = world.createTransformEntity(this.group, { parent });

    // Controls: two columns, tilted toward the user, lower-left.
    this.controls.position.set(-0.31, -0.06, 0.16);
    this.controls.rotation.set(-0.25, 0.5, 0);
    const controlsEntity = world.createTransformEntity(this.controls, { parent: groupEntity });
    const rows = Math.ceil(defs.length / 2);
    defs.forEach((def, i) => {
      const panel = new TextPanel({ width: BTN_W, height: BTN_H, pxPerMeter: PPM, padding: 10, radius: 22, align: 'center' });
      const col = i % 2;
      const row = Math.floor(i / 2);
      panel.mesh.position.set((col - 0.5) * (BTN_W + GAP), ((rows - 1) / 2 - row) * (BTN_H + GAP), 0);
      const entry = { def, panel, hovered: false, entity: null as unknown as Entity };
      entry.entity = makeInteractive(world, panel.mesh, controlsEntity, {
        press: () => {
          if (def.enabled()) def.onPress();
          this.dirty = true;
        },
        hover: (on) => {
          entry.hovered = on;
          this.dirty = true;
        },
      });
      this.buttons.push(entry);
    });

    // Captions: above the system.
    this.caption = new TextPanel({ width: 0.52, height: 0.19, pxPerMeter: PPM, padding: 36, radius: 30 });
    this.caption.mesh.position.set(0, 0.27, -0.02);
    this.caption.mesh.rotation.x = 0.12;
    world.createTransformEntity(this.caption.mesh, { parent: groupEntity });

    // Evidence: right side, tilted toward the user.
    this.evidenceGroup.position.set(0.33, 0.04, 0.12);
    this.evidenceGroup.rotation.set(0, -0.5, 0);
    const evEntity = world.createTransformEntity(this.evidenceGroup, { parent: groupEntity });
    this.evidence = new TextPanel({ width: 0.3, height: 0.26, pxPerMeter: PPM, padding: 34, radius: 26 });
    world.createTransformEntity(this.evidence.mesh, { parent: evEntity });
    this.evidenceClose = new TextPanel({ width: 0.07, height: 0.03, pxPerMeter: PPM, padding: 8, radius: 20, align: 'center' });
    this.evidenceClose.draw([{ text: 'Close', size: 40, bold: true }], CSS.buttonBg);
    this.evidenceClose.mesh.position.set(0.105, -0.152, 0.002);
    makeInteractive(world, this.evidenceClose.mesh, evEntity, { press: onCloseEvidence });
    this.evidenceGroup.visible = false;
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
      const enabled = b.def.enabled();
      const primary = enabled && (b.def.primary?.() ?? false);
      const bg = !enabled ? CSS.buttonDisabled : primary ? CSS.buttonPrimary : b.hovered ? 'rgba(64,86,118,0.98)' : CSS.buttonBg;
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
      lines.push({ text: `${b.glyph} ${b.label}`, size: 32, color: b.color, bold: true });
      lines.push({ text: model.consequence.text, size: 36, color: CSS.text, gap: 8 });
    }
    if (model.tutor) {
      const b = TRUTH_BADGE[model.tutor.status];
      lines.push({ text: `${model.tutor.source === 'live' ? 'Tutor (live AI)' : 'Guide (offline)'} · ${b.glyph} ${b.label}`, size: 30, color: b.color, bold: true });
      lines.push({ text: model.tutor.say, size: 38 });
    }
    if (model.note) lines.push({ text: model.note, size: 30, color: CSS.muted });
    this.caption.draw(lines);

    this.evidenceGroup.visible = evidence !== null;
    if (evidence) this.evidence.draw(evidenceLines(evidence));
  }
}

function evidenceLines(ev: Evidence): TextLine[] {
  const badge = TRUTH_BADGE[ev.truth_status];
  const lines: TextLine[] = [
    { text: 'EVIDENCE', size: 28, color: CSS.muted, bold: true },
    { text: ev.title, size: 40, bold: true, gap: 4 },
    { text: `${badge.glyph} ${badge.label}`, size: 30, color: badge.color, bold: true, gap: 10 },
  ];
  switch (ev.kind) {
    case 'source_range':
      // The revision is a content hash of the sample's source tree, not a git commit; say so.
      lines.push({ text: `${ev.source.path}:${ev.source.start_line}-${ev.source.end_line} @ tree ${ev.source.revision.slice(0, 12)}`, size: 28, color: CSS.action, mono: true, gap: 10 });
      for (const l of ev.source.excerpt.split('\n').slice(0, 12)) lines.push({ text: l || ' ', size: 28, mono: true });
      break;
    case 'test_run':
      lines.push({ text: `Recorded at build time: ${ev.run.recorded_at}`, size: 28, color: CSS.muted });
      lines.push({ text: `$ ${ev.run.command}`, size: 28, mono: true, color: CSS.action });
      lines.push({ text: `${ev.run.passed} passed · ${ev.run.failed} failed · ${ev.executed_node_ids.length} graph nodes executed`, size: 32, gap: 8 });
      if (ev.summary) lines.push({ text: ev.summary, size: 30, color: CSS.muted });
      break;
    case 'mutation_run':
      lines.push({ text: `Recorded at build time on a copy. The real repository was not modified.`, size: 28, color: CSS.muted });
      lines.push({ text: ev.mutation.description, size: 32, gap: 6 });
      for (const l of ev.mutation.diff.split('\n').slice(0, 4)) lines.push({ text: l, size: 26, mono: true, color: l.startsWith('-') ? CSS.fault : l.startsWith('+') ? '#7ee081' : CSS.text });
      lines.push({ text: `${ev.run.failed} failing: ${ev.run.failing_tests.slice(0, 3).join(', ')}`, size: 30, color: CSS.fault, gap: 6 });
      lines.push({ text: `$ ${ev.run.command}`, size: 26, mono: true, color: CSS.muted });
      break;
    case 'authored_rule':
      lines.push({ text: ev.rule.statement, size: 34, gap: 8 });
      lines.push({ text: `Source: ${ev.rule.model_source}`, size: 28, color: CSS.muted });
      break;
    case 'asset_license':
      lines.push({ text: `${ev.license.name}: ${ev.license.attribution}`, size: 30 });
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
