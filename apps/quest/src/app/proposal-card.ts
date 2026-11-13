import { Group, Vector3, type Entity, type World } from '@iwsdk/core';
import { TRUTH_BADGE, CSS } from './palette.ts';
import type { FlowView } from './explode-flow.ts';
import { makeInteractive } from './interactions.ts';
import { TextPanel, type TextLine } from './text.ts';

const PPM = 2800;
const W = 0.5;
const H = 0.38;
/** Draw order of the card; its buttons are one above. */
export const CARD_ORDER = 40;
const BTN_W = 0.13;
const BTN_H = 0.04;
const GAP = 0.012;
/**
 * Where it stands in the anchor's frame: just in front of the model's centre, drawn over it. Any
 * nearer and it fills the view: at the seated eye (about 0.7 m from the model) half a metre of
 * card this far away spans about 42° by 36° with its buttons, inside the 60° by 50° cone (ADR-0014).
 */
const AT = new Vector3(0, 0.04, 0.06);
// Nothing here is smaller than the app's smallest reading size (ui.ts: 32 px at this density).
const BODY = 32;
const LABEL = 28;

const STAGE_TEXT: Record<string, string> = {
  plan: 'Asking the AI model whether this can be drawn',
  research: 'Reading about it',
  outline: 'Asking the AI model what its parts would be',
  download: 'Downloading the source at that commit',
  index: 'Reading the source and finding the calls',
  curate: 'Asking the AI model to group the parts',
  draft: 'The AI model is writing the draft',
  assemble: 'Assembling the model and checking it',
};

export interface CardButton {
  id: 'build' | 'cancel';
  label: string;
  primary: boolean;
}

/** The buttons the card shows for a view. The app lists the same two for the assistant. */
export function cardButtons(view: FlowView): CardButton[] {
  switch (view.phase) {
    case 'proposed':
      return [
        { id: 'build', label: 'Build', primary: true },
        { id: 'cancel', label: 'Cancel', primary: false },
      ];
    case 'researching':
      return [{ id: 'cancel', label: 'Cancel', primary: false }];
    case 'building':
      return [{ id: 'cancel', label: 'Stop', primary: false }];
    case 'stopped':
      return [{ id: 'cancel', label: 'Close', primary: true }];
    default:
      return [];
  }
}

/** How long, in the words the card uses. The figures are the server's own timings, or there are none. */
export function estimateText(estimate: { low_seconds: number; high_seconds: number; basis: string } | null): string {
  if (!estimate) return 'How long: unknown. This server has not timed a build yet.';
  const { low_seconds: low, high_seconds: high, basis } = estimate;
  const span = low === high ? `about ${low} second${low === 1 ? '' : 's'}` : `about ${low} to ${high} seconds`;
  return `How long: ${span}, going by ${basis}.`;
}

/** What the card says for a view, top to bottom. */
export function cardLines(view: FlowView): TextLine[] {
  switch (view.phase) {
    case 'researching':
      return [
        { text: 'LOOKING IT UP', size: LABEL, bold: true, color: CSS.action, gap: 8 },
        { text: view.query, size: 44, bold: true, gap: 10 },
        { text: `${STAGE_TEXT[view.stage ?? 'research'] ?? 'Reading about it'}. Nothing is being built.`, size: BODY, color: CSS.muted },
      ];
    case 'proposed': {
      const p = view.proposal;
      const head: TextLine[] =
        p.kind === 'repository'
          ? [
              { text: p.repository.full_name, size: 46, bold: true, gap: 2 },
              { text: `commit ${p.repository.commit.slice(0, 7)} of ${p.repository.default_branch}  ·  licence: ${p.repository.license ?? 'none reported'}`, size: LABEL, color: CSS.muted, gap: p.found_by_search ? 4 : 12 },
              ...(p.found_by_search
                ? [{ text: `Found by searching GitHub for "${p.found_by_search}", most starred first. Check it is the one you meant.`, size: LABEL, bold: true, color: CSS.path, gap: 12 } satisfies TextLine]
                : []),
            ]
          : [
              { text: `${p.subject.name}  ·  an AI draft`, size: 46, bold: true, gap: 2 },
              { text: `${TRUTH_BADGE.inferred.glyph} ${p.model} says: ${p.subject.summary}`, size: LABEL, color: TRUTH_BADGE.inferred.color, gap: 4 },
              { text: `Expected parts: ${p.outline.join(', ')}.`, size: LABEL, color: CSS.muted, gap: 4 },
              { text: `Read for it: ${p.sources.map((s) => s.title).join('; ')} (Wikipedia).`, size: LABEL, color: CSS.muted, gap: 12 },
            ];
      return [
        { text: 'PROPOSAL  ·  NOTHING IS BUILT YET', size: LABEL, bold: true, color: CSS.action, gap: 6 },
        ...head,
        { text: 'WILL CREATE', size: LABEL, bold: true, color: CSS.path, gap: 2 },
        ...p.creates.map((text, i): TextLine => ({ text: `• ${text}`, size: BODY, gap: i === p.creates.length - 1 ? 12 : 2 })),
        { text: 'WILL NOT', size: LABEL, bold: true, color: CSS.path, gap: 2 },
        ...p.leaves_out.map((text, i): TextLine => ({ text: `• ${text}`, size: BODY, gap: i === p.leaves_out.length - 1 ? 12 : 2 })),
        { text: `${TRUTH_BADGE.inferred.glyph} ${p.disclosure}`, size: BODY, color: TRUTH_BADGE.inferred.color, gap: 12 },
        { text: estimateText(p.estimate), size: BODY, bold: true },
      ];
    }
    case 'building':
    case 'receiving':
      return [
        { text: 'BUILDING', size: LABEL, bold: true, color: CSS.action, gap: 8 },
        { text: view.title, size: 46, bold: true, gap: 10 },
        {
          text: view.phase === 'receiving' ? 'Built. Fetching it and checking it again here' : view.stage ? (STAGE_TEXT[view.stage] ?? 'Working') : 'Starting',
          size: 36,
          gap: 6,
        },
        // Whole seconds as the server counts them; no percentage, because none is known.
        ...(view.phase === 'building' ? [{ text: `${Math.floor(view.seconds)} s so far`, size: BODY, color: CSS.muted }] : []),
      ];
    case 'stopped':
      return [
        { text: view.heading, size: LABEL, bold: true, color: CSS.fault, gap: 10 },
        { text: view.message, size: 36 },
      ];
    default:
      return [];
  }
}

/**
 * The proposal card: what the learner reads before anything is built, with Build and Cancel
 * under it, and then how the build is getting on. It stands in front of the model and is drawn
 * over everything, like the other panels you open to read.
 */
export class ProposalCard {
  readonly group = new Group();
  private readonly body: TextPanel;
  private readonly buttons: Array<{ panel: TextPanel; hovered: boolean; def: CardButton | null }> = [];
  private view: FlowView = { phase: 'idle' };
  private dirty = false;

  constructor(
    world: World,
    parent: Entity,
    private readonly onPress: (id: CardButton['id']) => void,
  ) {
    const entity = world.createTransformEntity(this.group, { parent });
    // Opaque, unlike the other panels: it is read over an open model, whose labels would show through.
    this.body = new TextPanel({ width: W, height: H, pxPerMeter: PPM, padding: 34, radius: 28, background: 'rgb(6,14,26)' });
    // The card takes rays so a pinch on it never reaches the model behind.
    makeInteractive(world, this.body.mesh, entity, { ui: true });
    for (let i = 0; i < 2; i++) {
      const panel = new TextPanel({ width: BTN_W, height: BTN_H, pxPerMeter: PPM, padding: 10, radius: 22, align: 'center' });
      const slot = { panel, hovered: false, def: null as CardButton | null };
      makeInteractive(world, panel.mesh, entity, {
        press: () => {
          if (slot.def) this.onPress(slot.def.id);
        },
        hover: (on) => {
          slot.hovered = on;
          this.dirty = true;
        },
        ui: true,
      });
      this.buttons.push(slot);
    }
    // Above every other panel, the part menu included: nothing else is pressed while it is up.
    for (const [p, order] of [[this.body, CARD_ORDER], ...this.buttons.map((b) => [b.panel, CARD_ORDER + 1] as const)] as const) {
      p.mesh.material.depthTest = false;
      p.mesh.renderOrder = order;
    }
    this.show({ phase: 'idle' });
  }

  get isOpen(): boolean {
    return this.view.phase !== 'idle';
  }

  /** Everything the card says right now, as plain text (tests and the walkthrough). */
  get text(): string {
    return this.isOpen ? cardLines(this.view).map((l) => l.text).join('\n') : '';
  }

  show(view: FlowView): void {
    this.view = view;
    const open = view.phase !== 'idle';
    this.group.visible = open;
    this.group.scale.setScalar(open ? 1 : 1e-4); // hidden, and out of a ray's reach
    this.dirty = open;
    if (open) return;
    for (const b of this.buttons) {
      b.hovered = false;
      b.def = null;
      b.panel.mesh.visible = false;
      b.panel.mesh.scale.setScalar(1e-4);
    }
  }

  /** Once a frame: keep it facing the eye; redraw only when something changed. No allocation while idle. */
  update(eye: Vector3): void {
    if (!this.isOpen) return;
    this.group.position.copy(AT);
    this.group.rotation.set(0, Math.atan2(eye.x - AT.x, eye.z - AT.z), 0);
    if (!this.dirty) return;
    this.dirty = false;
    this.body.draw(cardLines(this.view));
    const defs = cardButtons(this.view);
    const y = -H / 2 - GAP - BTN_H / 2;
    this.buttons.forEach((b, i) => {
      const def = defs[i] ?? null;
      b.def = def;
      b.panel.mesh.visible = !!def;
      b.panel.mesh.scale.setScalar(def ? (b.hovered ? 1.04 : 1) : 1e-4);
      if (!def) return;
      b.panel.mesh.position.set((i - (defs.length - 1) / 2) * (BTN_W + GAP), y, 0.002);
      b.panel.draw([{ text: def.label, size: 40, bold: true }], def.primary ? CSS.buttonPrimary : b.hovered ? CSS.buttonHover : CSS.buttonBg);
    });
  }
}
