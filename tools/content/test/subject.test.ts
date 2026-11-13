import { createContext, computeConsequence, initialState, reduce } from '@explode/lesson-engine';
import { describe, expect, it } from 'vitest';
import { SubjectDraft, buildSubjectBundle, draftProblems, layoutProblems, subjectSystemId, targetOverlaps, verifyBundle } from '../src/index.ts';
import { DRAFT, META } from './subject-fixture.ts';

const bundle = buildSubjectBundle(DRAFT, META);
const change = (fn: (d: SubjectDraft) => void) => {
  const copy = structuredClone(DRAFT);
  fn(copy);
  return copy;
};

describe('a subject drafted by a model', () => {
  it('passes schema, integrity, layout and hash checks, and no two ray targets overlap', () => {
    expect(verifyBundle(bundle)).toEqual([]);
    expect(layoutProblems(bundle.layout)).toEqual([]);
    expect(targetOverlaps(bundle.graph, bundle.layout)).toEqual([]);
  });

  it('labels everything a hypothesis: nothing is a teaching model, static or observed, and nothing cites evidence', () => {
    const { nodes, edges, paths } = bundle.graph;
    expect(nodes).toHaveLength(7);
    for (const x of [...nodes, ...edges, ...paths]) expect(x, x.id).toMatchObject({ truth_status: 'inferred', evidence_ids: [] });
    expect(bundle.evidence.map((e) => e.truth_status)).toEqual(['inferred']);
    expect(bundle.graph.display_name).toBe('Lantern World (AI draft)');
    expect(bundle.graph.system_kind).toBe('mechanical');
    expect(bundle.graph.system_id).toBe(subjectSystemId(DRAFT));
    expect(bundle.graph.system_id).toMatch(/^system:ai\/lantern-world@[0-9a-f]{12}$/);
  });

  it('records what was read as the server gave it, and as a record, not as evidence for a claim', () => {
    const [read] = bundle.evidence;
    expect(read).toMatchObject({ id: 'ev:sources:read', kind: 'asset_license', title: 'What the AI model read', license: { spdx: 'CC-BY-SA-4.0', attribution: 'Wikipedia contributors' } });
    expect(read!.summary).toContain('test-model-1');
    expect(read!.summary).toContain('Lantern World, Weather of Lantern World');
    expect(read!.summary).toContain('Nobody checked the draft against it');
    const cited = [...bundle.graph.nodes, ...bundle.graph.edges, ...bundle.graph.paths].flatMap((x) => x.evidence_ids);
    expect(cited).toEqual([]);
  });

  it('lets only the lesson link be cut, and a cut is a hypothesis too, never the teaching model', () => {
    const mutable = bundle.graph.edges.filter((e) => e.is_mutable_in_sandbox).map((e) => e.id);
    expect(mutable).toEqual(['edge:transmits:part:crust->part:air']);
    const ctx = createContext(bundle);
    const c = computeConsequence(ctx, mutable[0]!);
    expect(c).toMatchObject({ truth_status: 'inferred', evidence_ids: [], first_affected_id: 'part:air', affected_ids: ['part:air', 'part:dust'] });
  });

  it('places the layers inside one another, largest outside, and everything else on a ring', () => {
    const parts = bundle.assets!.parts;
    const at = bundle.layout.placements;
    // A layer is a sphere whatever shape was asked for (the mantle asked for a box).
    for (const id of ['part:crust', 'part:mantle', 'part:core']) {
      expect(parts[id]!.shape).toBe('sphere');
      expect(at[id]!.collapsed).toEqual([0, 0, 0]);
    }
    expect(parts['part:crust']!.size[0]).toBeGreaterThan(parts['part:mantle']!.size[0]);
    expect(parts['part:mantle']!.size[0]).toBeGreaterThan(parts['part:core']!.size[0]);
    for (const id of ['part:air', 'part:dust', 'part:ice', 'part:moon']) expect(Math.hypot(...at[id]!.collapsed)).toBeGreaterThan(0.05);
    expect(parts['part:air']!.shape).toBe('torus');
    // Exploded, the chain reads left to right along the middle.
    const xs = ['part:crust', 'part:air', 'part:dust'].map((id) => at[id]!.exploded);
    expect(xs.map((p) => p[1])).toEqual([0, 0, 0]);
    expect(xs[0]![0]).toBeLessThan(xs[1]![0]);
    expect(xs[1]![0]).toBeLessThan(xs[2]![0]);
  });

  it('leaves room for the plug of the cut link between its two parts, whatever their sizes', () => {
    const clear = (b: ReturnType<typeof buildSubjectBundle>, from: string, to: string) => {
      const [a, z] = [b.layout.placements[from]!.exploded, b.layout.placements[to]!.exploded];
      const half = Math.hypot(a[0] - z[0], a[1] - z[1]) / 2; // the plug is halfway
      return Math.min(half - b.assets!.parts[from]!.size[0] / 2, half - b.assets!.parts[to]!.size[0] / 2);
    };
    // The fixture cuts crust -> air: the largest layer next to a large ring.
    expect(clear(bundle, 'part:crust', 'part:air')).toBeGreaterThanOrEqual(0.04 - 1e-4);
    // Two layers side by side on the chain, cut between them.
    const layers = buildSubjectBundle(change((d) => {
      d.chain = ['core', 'mantle', 'crust'];
      d.cut = { from: 'core', to: 'mantle' };
    }), META);
    expect(clear(layers, 'part:core', 'part:mantle')).toBeGreaterThanOrEqual(0.04 - 1e-4);
    expect(targetOverlaps(layers.graph, layers.layout)).toEqual([]);
  });

  it('writes a lesson that says at every turn that this is a draft, and that the engine can run to the end', () => {
    const lesson = bundle.lessons[0]!;
    const text = lesson.steps.map((s) => s.caption).join(' ');
    expect(text).toContain('This is an AI draft of Lantern World, written just now by test-model-1 after reading 2 Wikipedia articles.');
    expect(text).toContain('Nobody has checked it');
    expect(text).toContain('stand for nothing real'); // the draft's own statement of its limits
    expect(text).toContain('That is what this draft says would happen. It is not a measurement');
    expect(text).not.toMatch(/teaching model|observed|recorded/i);
    expect(lesson.steps.every((s) => s.caption.length <= 280)).toBe(true);
    expect(lesson.repair_candidates).toContain('part:air');
    expect(lesson.repair_candidates).toHaveLength(3);

    const ctx = createContext(bundle);
    let s = initialState(ctx, lesson.id);
    const edge = lesson.break_edge_id!;
    for (const event of [
      { type: 'set_explode', factor: 1 },
      { type: 'next' },
      { type: 'trace', path_id: 'path:chain' },
      { type: 'unplug', edge_id: edge },
      { type: 'predict', target_id: 'part:air' },
      { type: 'next' },
      { type: 'plug', edge_id: edge, target_id: 'part:air' },
      { type: 'set_explode', factor: 0 },
    ] as const) {
      s = reduce(ctx, s, event);
    }
    expect(s.lesson?.status).toBe('complete');
    expect(s.broken_edge_ids).toEqual([]);
  });

  it('is the same bundle from the same draft, and a different system from a different one', () => {
    expect(buildSubjectBundle(DRAFT, META).content_hash).toBe(bundle.content_hash);
    expect(subjectSystemId(change((d) => (d.parts[0]!.summary = 'A different outer shell of rock.')))).not.toBe(bundle.graph.system_id);
  });

  it('fits its row however many parts there are', () => {
    const many = change((d) => {
      for (let i = 0; i < 4; i++) d.parts.push({ id: `extra-${i}`, label: `Extra ${i}`, summary: 'One more part for the test.', shape: 'box', size: 'large', color: '#445566', nested: null });
      d.parts.push({ id: 'far', label: 'Far end', summary: 'The far end of a longer chain.', shape: 'sphere', size: 'large', color: '#334455', nested: null });
      d.connections.push({ from: 'dust', to: 'far', kind: 'transmits', flow: 'data', label: 'grit', rule: 'The storm carries grit to the far end.' });
      d.connections.push({ from: 'far', to: 'ice', kind: 'transmits', flow: 'data', label: 'more grit', rule: 'The far end passes grit on to the ice.' });
      d.connections.push({ from: 'ice', to: 'moon', kind: 'transmits', flow: 'data', label: 'glint', rule: 'The ice reflects light toward the moon.' });
      d.chain = ['crust', 'air', 'dust', 'far', 'ice', 'moon'];
    });
    expect(SubjectDraft.safeParse(many).success).toBe(true);
    const big = buildSubjectBundle(many, META);
    expect(verifyBundle(big)).toEqual([]);
    expect(targetOverlaps(big.graph, big.layout)).toEqual([]);
  });
});

describe('a draft that does not fit', () => {
  it.each([
    ['a chain step that is not a connection', (d: SubjectDraft) => (d.chain = ['core', 'crust', 'air']), 'chain step core -> crust is not one of the connections'],
    ['a cut that is not on the chain', (d: SubjectDraft) => (d.cut = { from: 'core', to: 'mantle' }), 'the cut core -> mantle is not a step of the chain'],
    ['a connection to a part that does not exist', (d: SubjectDraft) => (d.connections[0]!.to = 'ocean'), 'connection to unknown part ocean'],
    ['two parts with one id', (d: SubjectDraft) => (d.parts[1]!.id = 'crust'), 'duplicate part id crust'],
    ['two parts with one label', (d: SubjectDraft) => (d.parts[1]!.label = 'crust'), 'two parts are both labelled "crust"'],
    ['two layers at one depth', (d: SubjectDraft) => (d.parts[1]!.nested = 0), 'two parts have the same "nested" number'],
    ['a part connected to itself', (d: SubjectDraft) => (d.connections[4]!.to = 'air'), 'part air is connected to itself'],
  ])('reports %s', (_name, fn, problem) => {
    const bad = change(fn);
    expect(draftProblems(bad)).toContain(problem);
    expect(() => buildSubjectBundle(bad, META)).toThrow(/does not fit/);
  });

  it('is held to the form: no truth status, no evidence, no positions of its own', () => {
    const sneaky = { ...structuredClone(DRAFT), truth_status: 'observed', evidence: [{ id: 'ev:made:up' }], layout: { x: 9 } } as unknown;
    const parsed = SubjectDraft.parse(sneaky);
    expect(Object.keys(parsed).sort()).toEqual(['chain', 'chain_label', 'connections', 'cut', 'parts', 'statement', 'title']);
    expect(SubjectDraft.safeParse({ ...DRAFT, parts: DRAFT.parts.slice(0, 3) }).success).toBe(false);
    expect(SubjectDraft.safeParse(change((d) => (d.parts[0]!.color = 'red'))).success).toBe(false);
    expect(SubjectDraft.safeParse(change((d) => (d.connections[0]!.kind = 'calls' as never))).success).toBe(false);
  });
});
