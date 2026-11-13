import type { ContentBundle, Evidence, FlowPath, GraphEdge, GraphNode, Layout, Lesson, PartShape } from '@explode/contracts';
import { FlowType } from '@explode/contracts';
import { sha256 } from '@explode/indexer';
import { z } from 'zod';
import type { BundleDraft } from './bundle.ts';
import { finalizeBundle } from './bundle.ts';
import { ANCHOR_DISTANCE, CONE_DEG, targetOverlaps } from './layout.ts';

/**
 * A subject nobody authored ("Mars"), drafted by a model on request (ADR-0026).
 *
 * The model fills in a fixed form: parts, connections, one chain to trace and one link on it to
 * cut. Everything else is done here and is not the model's to choose: ids, positions, the lesson
 * (from a template), and above all the labelling.
 *
 * Truth contract (ADR-0007): a model wrote all of it, so every part, connection and path is
 * `inferred` and cites no evidence. It is never `authored_model`, which means a person validated
 * the model. What was read during research is recorded as "what the model read", and is not
 * evidence for any single claim.
 */

const Slug = z.string().regex(/^[a-z][a-z0-9-]{1,30}$/);
const Hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);

/** The form the model fills in. Checked here; a draft that does not fit is sent back, never repaired. */
export const SubjectDraft = z.object({
  /** The plain name of the thing. */
  title: z.string().min(2).max(40),
  /** What this model simplifies and leaves out, in one or two sentences. */
  statement: z.string().min(20).max(300),
  parts: z
    .array(
      z.object({
        id: Slug,
        label: z.string().min(2).max(28),
        summary: z.string().min(10).max(200),
        shape: z.enum(['box', 'cylinder', 'sphere', 'torus']),
        size: z.enum(['small', 'medium', 'large']),
        color: Hex,
        /** For things made of layers around a centre: 0 is the outermost layer. Null for anything else. */
        nested: z.number().int().min(0).max(5).nullable(),
      }),
    )
    .min(5)
    .max(12),
  connections: z
    .array(
      z.object({
        from: Slug,
        to: Slug,
        kind: z.enum(['powers', 'transmits', 'depends_on']),
        flow: FlowType,
        label: z.string().min(2).max(30),
        /** The rule this connection stands for, as one plain sentence. */
        rule: z.string().min(10).max(200),
      }),
    )
    .min(4)
    .max(16),
  /** A chain of three to six parts to trace; each step must be one of the connections. */
  chain: z.array(Slug).min(3).max(6),
  /** A few words for the chain, to follow "Trace". */
  // Asked to be at most 36; a little over still fits the Trace button.
  chain_label: z.string().min(3).max(48),
  /** The link on the chain the learner cuts. */
  cut: z.object({ from: Slug, to: Slug }),
});
export type SubjectDraft = z.infer<typeof SubjectDraft>;

/** The same form as a JSON schema for the model (no length rules: those are checked here). */
export const SUBJECT_DRAFT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'statement', 'parts', 'connections', 'chain', 'chain_label', 'cut'],
  properties: {
    title: { type: 'string' },
    statement: { type: 'string' },
    parts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'label', 'summary', 'shape', 'size', 'color', 'nested'],
        properties: {
          id: { type: 'string' },
          label: { type: 'string' },
          summary: { type: 'string' },
          shape: { type: 'string', enum: ['box', 'cylinder', 'sphere', 'torus'] },
          size: { type: 'string', enum: ['small', 'medium', 'large'] },
          color: { type: 'string' },
          nested: { type: ['integer', 'null'] },
        },
      },
    },
    connections: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['from', 'to', 'kind', 'flow', 'label', 'rule'],
        properties: {
          from: { type: 'string' },
          to: { type: 'string' },
          kind: { type: 'string', enum: ['powers', 'transmits', 'depends_on'] },
          flow: { type: 'string', enum: [...FlowType.options] },
          label: { type: 'string' },
          rule: { type: 'string' },
        },
      },
    },
    chain: { type: 'array', items: { type: 'string' } },
    chain_label: { type: 'string' },
    cut: { type: 'object', additionalProperties: false, required: ['from', 'to'], properties: { from: { type: 'string' }, to: { type: 'string' } } },
  },
} as const;

export const SUBJECT_DRAFT_PROMPT = `You draft a simple teaching model of one subject, to be shown as a few 3D parts that a learner pulls apart. You are given the subject and text from encyclopedia articles about it. Use only what that text supports and what is common knowledge about the subject. Leave out anything you are unsure of. Return JSON.

"title": the plain name of the subject, at most 40 characters.
"statement": one or two sentences, at most 300 characters, saying what this model simplifies or leaves out.

"parts": 6 to 10 parts. Each is one real component, layer or body of the subject, not an idea about it.
- "id": lowercase slug, letters, digits and dashes, 2 to 30 characters, unique.
- "label": at most 28 characters, unique.
- "summary": one sentence, at most 200 characters, saying what the part is or does.
- "shape": "sphere", "box", "cylinder" or "torus" (a ring), whichever is closest.
- "size": "small", "medium" or "large", relative to the other parts.
- "color": "#rrggbb", close to how the part looks, and different enough from its neighbours to tell apart.
- "nested": for a subject made of layers around a centre (a planet, a cell, an onion), give each layer a whole number: 0 for the outermost, 1 for the next one in, and so on. Use null for every part that is not such a layer. A subject with no layers has null everywhere.

"connections": 5 to 12. Each says one part supplies, drives or supports another.
- "from" and "to": part ids. "from" is the part that supplies.
- "kind": "powers" (drives it), "transmits" (passes something on to it) or "depends_on" ("from" is what "to" needs).
- "flow": what passes along it: "heat", "electrical", "torque", "data", "control" or "request". Pick the nearest.
- "label": at most 30 characters, what passes.
- "rule": one sentence, at most 200 characters, stating the dependency plainly.

"chain": 3 to 5 part ids in order, a cause-and-effect chain worth following. Every step from one part to the next must be one of the connections, with the same "from" and "to".
"chain_label": at most 36 characters, completing the phrase "Trace ...", for example "sunlight to the dust storm".
"cut": the "from" and "to" of one step of the chain. Choose a step where it is clear that the parts after it would stop.

Do not include brand names, company names or product names. Do not include instructions for making or doing anything.`;

/** Problems that make a draft unusable; empty when it can be built. Sent back to the model as they are. */
export function draftProblems(draft: SubjectDraft): string[] {
  const out: string[] = [];
  const ids = new Set<string>();
  const labels = new Set<string>();
  for (const p of draft.parts) {
    if (ids.has(p.id)) out.push(`duplicate part id ${p.id}`);
    ids.add(p.id);
    const label = p.label.trim().toLowerCase();
    if (labels.has(label)) out.push(`two parts are both labelled "${p.label}"`);
    labels.add(label);
  }
  const layers = draft.parts.filter((p) => p.nested !== null).map((p) => p.nested!);
  if (new Set(layers).size !== layers.length) out.push('two parts have the same "nested" number');
  const links = new Set<string>();
  for (const c of draft.connections) {
    if (!ids.has(c.from)) out.push(`connection from unknown part ${c.from}`);
    if (!ids.has(c.to)) out.push(`connection to unknown part ${c.to}`);
    if (c.from === c.to) out.push(`part ${c.from} is connected to itself`);
    const key = `${c.kind}:${c.from}->${c.to}`;
    if (links.has(key)) out.push(`the connection ${c.from} -> ${c.to} (${c.kind}) appears twice`);
    links.add(key);
  }
  const connected = (from: string, to: string) => draft.connections.some((c) => c.from === from && c.to === to);
  if (new Set(draft.chain).size !== draft.chain.length) out.push('the chain visits a part twice');
  for (const id of draft.chain) if (!ids.has(id)) out.push(`chain names unknown part ${id}`);
  for (let i = 1; i < draft.chain.length; i++) {
    if (!connected(draft.chain[i - 1]!, draft.chain[i]!)) out.push(`chain step ${draft.chain[i - 1]} -> ${draft.chain[i]} is not one of the connections`);
  }
  const at = draft.chain.indexOf(draft.cut.from);
  if (at === -1 || draft.chain[at + 1] !== draft.cut.to) out.push(`the cut ${draft.cut.from} -> ${draft.cut.to} is not a step of the chain`);
  return out;
}

/** Where the model's text came from. Recorded by the server from its own fetches, never from the model. */
export interface SubjectSource {
  title: string;
  url: string;
}

export interface SubjectMeta {
  provider: string;
  model: string;
  created_at: string;
  sources: SubjectSource[];
}

// ── layout: the server's, not the model's ─────────────────────────────────────────────────────

const DIAMETER = { small: 0.03, medium: 0.044, large: 0.062 } as const;
/** The outermost layer of a layered subject, and how much smaller each layer in is. */
const LAYER_OUTER = 0.14;
const LAYER_STEP = 0.8;
const LAYER_MIN = 0.036;
/** Where parts that are not layers sit while the model is closed: on a ring around the centre. */
const RING_RADIUS = 0.105;
/** Exploded: the chain along the middle, the rest in a row above and a row below. */
const ROW_Y = [0.16, 0, -0.15] as const;
const ROW_WIDTH = 0.6;
const ROW_GAP = 0.024;
/** Narrowest slot a part gets in its row, so its ray target (4 cm) never touches its neighbour's. */
const MIN_SLOT = 0.046;

function round(v: number): number {
  const r = Math.round(v * 10000) / 10000;
  return Object.is(r, -0) ? 0 : r;
}

function shapeOf(shape: PartShape['shape'], d: number, color: string): PartShape {
  const size: [number, number, number] =
    shape === 'box' ? [d, d * 0.7, d * 0.7] : shape === 'cylinder' ? [d * 0.7, d, 0] : shape === 'torus' ? [d, d * 0.22, 0] : [d, d, d];
  return { shape, size: size.map(round) as [number, number, number], color, rotation_deg: [0, 0, 0] };
}

interface Placed {
  id: string;
  shape: PartShape;
  diameter: number;
  collapsed: [number, number, number];
  exploded: [number, number, number];
}

function place(draft: SubjectDraft): Placed[] {
  const layers = draft.parts.filter((p) => p.nested !== null).sort((a, b) => a.nested! - b.nested!);
  const loose = draft.parts.filter((p) => p.nested === null);
  const diameter = new Map<string, number>();
  layers.forEach((p, i) => diameter.set(p.id, Math.max(LAYER_MIN, LAYER_OUTER * LAYER_STEP ** i)));
  for (const p of loose) diameter.set(p.id, DIAMETER[p.size]);

  // Rows: the chain in order along the middle; every other part above or below, nearest first
  // to the chain part it connects to, alternating so the two rows stay even.
  const chainAt = new Map(draft.chain.map((id, i) => [id, i]));
  const near = (id: string) => {
    let best = draft.chain.length;
    for (const c of draft.connections) {
      const other = c.from === id ? c.to : c.to === id ? c.from : null;
      if (other !== null && chainAt.has(other)) best = Math.min(best, chainAt.get(other)!);
    }
    return best;
  };
  const rest = draft.parts.filter((p) => !chainAt.has(p.id)).sort((a, b) => near(a.id) - near(b.id) || (a.id < b.id ? -1 : 1));
  const rows: string[][] = [[], [...draft.chain], []];
  rest.forEach((p, i) => rows[i % 2 === 0 ? 0 : 2]!.push(p.id));

  // One scale for the whole model, so the widest row fits and the parts keep their proportions.
  const slot = (id: string, k: number) => Math.max(MIN_SLOT, diameter.get(id)! * k);
  const width = (row: string[], k: number) => row.reduce((w, id) => w + slot(id, k), 0) + ROW_GAP * Math.max(0, row.length - 1);
  let scale = 1;
  while (scale > 0.4 && rows.some((row) => width(row, scale) > ROW_WIDTH)) scale -= 0.05;

  const exploded = new Map<string, [number, number, number]>();
  rows.forEach((row, r) => {
    let x = -width(row, scale) / 2;
    for (const id of row) {
      const w = slot(id, scale);
      exploded.set(id, [round(x + w / 2), ROW_Y[r]!, 0]);
      x += w + ROW_GAP;
    }
  });

  const ring = layers.length ? RING_RADIUS : 0.07;
  return draft.parts.map((p) => {
    const d = diameter.get(p.id)! * scale;
    const i = loose.indexOf(p);
    const angle = i === -1 ? 0 : (i / Math.max(1, loose.length)) * Math.PI * 2 + Math.PI / 2;
    return {
      id: `part:${p.id}`,
      // A layer is always a sphere, whatever was asked for: the layers sit inside one another.
      shape: shapeOf(p.nested !== null ? 'sphere' : p.shape, d, p.color.toLowerCase()),
      diameter: d,
      collapsed: i === -1 ? [0, 0, 0] : [round(Math.cos(angle) * ring), round(Math.sin(angle) * ring), 0],
      exploded: exploded.get(p.id)!,
    };
  });
}

// ── bundle ────────────────────────────────────────────────────────────────────────────────────

export const SUBJECT_SOURCES_EVIDENCE = 'ev:sources:read';

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/** The system id of a draft: its name and a hash of its content, so two drafts never share one. */
export function subjectSystemId(draft: SubjectDraft): string {
  const slug = draft.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'subject';
  return `system:ai/${slug}@${sha256(JSON.stringify(draft)).slice(0, 12)}`;
}

/** Build the bundle for a draft that has no problems. Throws on one that has. */
export function buildSubjectBundle(draft: SubjectDraft, meta: SubjectMeta): ContentBundle {
  const problems = draftProblems(draft);
  if (problems.length) throw new Error(`the draft does not fit:\n- ${problems.join('\n- ')}`);
  const systemId = subjectSystemId(draft);
  const placed = place(draft);
  const onChain = new Set(draft.chain);

  const nodes: GraphNode[] = draft.parts.map((p) => ({
    id: `part:${p.id}`,
    kind: 'component',
    label: p.label,
    summary: p.summary,
    parent_id: null,
    truth_status: 'inferred',
    evidence_ids: [],
    importance: onChain.has(p.id) ? 0.8 : 0.5,
  }));
  const edgeId = (c: { kind: string; from: string; to: string }) => `edge:${c.kind}:part:${c.from}->part:${c.to}`;
  const cut = draft.connections.find((c) => c.from === draft.cut.from && c.to === draft.cut.to)!;
  const edges: GraphEdge[] = draft.connections.map((c) => ({
    id: edgeId(c),
    source_id: `part:${c.from}`,
    target_id: `part:${c.to}`,
    relation: c.kind,
    flows: [c.flow],
    truth_status: 'inferred',
    evidence_ids: [],
    // Only the lesson's link can be cut: it is the one whose rule the learner is shown.
    is_mutable_in_sandbox: c === cut,
    label: c.label,
  }));
  const chainEdges = draft.chain.slice(1).map((to, i) => draft.connections.find((c) => c.from === draft.chain[i] && c.to === to)!);
  const path: FlowPath = {
    id: 'path:chain',
    label: draft.chain_label,
    flow: chainEdges[0]!.flow,
    node_ids: draft.chain.map((id) => `part:${id}`),
    edge_ids: chainEdges.map(edgeId),
    truth_status: 'inferred',
    evidence_ids: [],
  };

  const layout: Layout = {
    system_id: systemId,
    anchor_distance: ANCHOR_DISTANCE,
    cone_deg: { ...CONE_DEG },
    placements: Object.fromEntries(placed.map((p) => [p.id, { collapsed: p.collapsed, exploded: p.exploded, radius: round(Math.min(0.035, Math.max(0.012, p.diameter / 2))) }])),
  };

  const names = meta.sources.map((s) => s.title).join(', ');
  const sources: Evidence = {
    id: SUBJECT_SOURCES_EVIDENCE,
    kind: 'asset_license',
    // Not evidence for any claim: a record of what was read. Nothing cites it.
    truth_status: 'inferred',
    title: 'What the AI model read',
    summary: clip(`Drafted by ${meta.model} on ${meta.created_at.slice(0, 10)} after reading ${meta.sources.length === 1 ? 'this Wikipedia article' : 'these Wikipedia articles'}: ${names}. What was read was not copied. Nobody checked the draft against it.`, 400),
    license: { name: 'Creative Commons Attribution-ShareAlike 4.0', spdx: 'CC-BY-SA-4.0', ...(meta.sources[0] ? { url: meta.sources[0].url } : {}), attribution: 'Wikipedia contributors' },
  };

  const graph: ContentBundle['graph'] = {
    schema_version: '1.0',
    system_id: systemId,
    system_kind: 'mechanical',
    display_name: `${draft.title} (AI draft)`,
    revision: { kind: 'content_hash', value: sha256(JSON.stringify(draft)) },
    nodes,
    edges,
    paths: [path],
  };
  const draftBundle: BundleDraft = {
    graph,
    evidence: [sources],
    layout,
    lessons: [subjectLesson(draft, meta, systemId, edgeId(cut))],
    assets: { parts: Object.fromEntries(placed.map((p) => [p.id, p.shape])) },
  };
  const bundle = finalizeBundle(draftBundle);
  const overlaps = targetOverlaps(bundle.graph, bundle.layout);
  if (overlaps.length) throw new Error(`the layout puts ray targets on top of each other:\n- ${overlaps.join('\n- ')}`);
  return bundle;
}

/** The lesson every draft gets. Its words say, at each step, that this is a draft. */
function subjectLesson(draft: SubjectDraft, meta: SubjectMeta, systemId: string, cutEdge: string): Lesson {
  const label = (id: string) => draft.parts.find((p) => p.id === id)!.label;
  const cut = draft.connections.find((c) => c.from === draft.cut.from && c.to === draft.cut.to)!;
  const from = label(cut.from);
  const to = label(cut.to);
  const n = meta.sources.length;
  const read = n === 0 ? 'with nothing to read from' : `after reading ${n} Wikipedia article${n === 1 ? '' : 's'}`;
  // Two wrong sockets beside the right one, from the chain first so they are plausible.
  const others = [...draft.chain, ...draft.parts.map((p) => p.id)].filter((id, i, all) => id !== cut.to && id !== cut.from && all.indexOf(id) === i).slice(0, 2);
  const steps: Lesson['steps'] = [
    {
      id: 'step:draft-explode',
      kind: 'explode',
      caption: `This is an AI draft of ${draft.title}, written just now by ${meta.model} ${read}. Nobody has checked it: every part and link is a hypothesis, marked ◌. Press Explode to open it up.`,
      hint: 'Press Explode. You can also pinch with both hands and pull them apart.',
      expect: { type: 'explode_at_least', factor: 0.8 },
      on_enter: [],
    },
    {
      id: 'step:draft-limits',
      kind: 'explain',
      caption: `What the draft says about itself: ${draft.statement} The shapes and sizes are rough stand-ins, not to scale.`,
      expect: { type: 'next' },
      on_enter: [],
    },
    {
      id: 'step:draft-trace',
      kind: 'trace',
      caption: `Press Trace to follow ${draft.chain_label}: from ${label(draft.chain[0]!)} to ${label(draft.chain[draft.chain.length - 1]!)}, as the draft has it.`,
      hint: 'The Trace button is in the panel next to you.',
      expect: { type: 'trace', path_id: 'path:chain' },
      on_enter: [],
    },
    {
      id: 'step:draft-unplug',
      kind: 'break',
      caption: `Cut one link of the draft: unplug ${from} from ${to}.`,
      hint: 'Select the highlighted link, then press Unplug.',
      expect: { type: 'unplug', edge_id: cutEdge },
      on_enter: [
        { type: 'highlight', target_ids: [`part:${cut.from}`, `part:${cut.to}`] },
        { type: 'show_annotation', target_id: `part:${cut.from}`, text: clip(`Draft: ${cut.rule}`, 200) },
      ],
    },
    {
      id: 'step:draft-predict',
      kind: 'predict',
      caption: 'Before you look: point at the first part that loses what it needs.',
      hint: `What does ${from} supply?`,
      expect: { type: 'predict' },
      on_enter: [{ type: 'ask_prediction', question: 'Which part loses its supply first?' }],
      feedback: {
        correct: clip(`Yes: in this draft it is ${to}. The draft's rule: ${cut.rule}`, 240),
        incorrect: clip(`In this draft it is ${to}. The draft's rule: ${cut.rule}`, 240),
      },
    },
    {
      id: 'step:draft-observe',
      kind: 'observe',
      caption: `${to} and everything after it on the chain go dark. That is what this draft says would happen. It is not a measurement, and nobody has checked it.`,
      expect: { type: 'next' },
      on_enter: [{ type: 'animate_flow', path_id: 'path:chain' }],
    },
    {
      id: 'step:draft-repair',
      kind: 'repair',
      caption: 'Plug the link back into the right socket.',
      hint: `The link came from ${from}.`,
      expect: { type: 'repair', edge_id: cutEdge },
      on_enter: [],
    },
    {
      id: 'step:draft-collapse',
      kind: 'transition',
      caption: 'The chain is whole again. Press Collapse to close it up, or push your hands together.',
      hint: 'Press Collapse. You can also bring your hands together.',
      expect: { type: 'collapse_below', factor: 0.1 },
      on_enter: [],
    },
  ];
  for (const step of steps) step.caption = clip(step.caption, 280);
  return {
    id: `lesson:draft:${systemId.slice('system:'.length)}`,
    system_id: systemId,
    title: clip(`An AI draft of ${draft.title}`, 80),
    objectives: [clip(`Follow one chain of cause and effect in a draft model of ${draft.title}.`, 160), 'Tell a draft from something that was checked.'],
    break_edge_id: cutEdge,
    repair_candidates: [`part:${cut.to}`, ...others.map((id) => `part:${id}`)].sort(),
    misconception_on_wrong_prediction: 'assumes-failure-is-local',
    steps,
  };
}
