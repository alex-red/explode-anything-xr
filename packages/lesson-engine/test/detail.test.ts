import { describe, expect, it } from 'vitest';
import { createContext, detailTier, initialState, pinnedIds, reduce, stepDetail, tierShown, visibleAtDetail } from '../src/index.ts';
import { miniBundle } from './fixture.ts';

describe('detail levels', () => {
  it('ranks clusters as key whatever their score, then splits the rest by importance', () => {
    expect(detailTier({ kind: 'cluster', importance: 0 })).toBe('key');
    expect(detailTier({ kind: 'function', importance: 0.6 })).toBe('key');
    expect(detailTier({ kind: 'module', importance: 0.5 })).toBe('supporting');
    expect(detailTier({ kind: 'class', importance: 0.45 })).toBe('supporting');
    expect(detailTier({ kind: 'function', importance: 0.44 })).toBe('extra');
  });

  it('shows more tiers at each level and steps stop at either end', () => {
    expect(tierShown('extra', 'supporting')).toBe(false);
    expect(tierShown('supporting', 'key')).toBe(false);
    expect(tierShown('extra', 'all')).toBe(true);
    expect(tierShown('key', 'key')).toBe(true);
    expect(stepDetail('key', -1)).toBe('key');
    expect(stepDetail('key', 1)).toBe('supporting');
    expect(stepDetail('all', 1)).toBe('all');
    expect(stepDetail('all', -1)).toBe('supporting');
  });

  it('pins what the learner needs: selection, highlights, the traced path, a cut and its sockets', () => {
    const bundle = miniBundle();
    const ctx = createContext(bundle);
    let s = initialState(ctx, null);
    expect(pinnedIds(ctx, s).size).toBe(0);
    const path = bundle.graph.paths[0]!;
    s = reduce(ctx, s, { type: 'trace', path_id: path.id });
    for (const id of path.node_ids) expect(pinnedIds(ctx, s).has(id)).toBe(true);
    const edge = bundle.graph.edges.find((e) => e.is_mutable_in_sandbox)!;
    s = reduce(ctx, s, { type: 'unplug', edge_id: edge.id });
    const pinned = pinnedIds(ctx, s);
    expect(pinned.has(edge.source_id) && pinned.has(edge.target_id)).toBe(true);
    const lesson = bundle.lessons.find((l) => l.break_edge_id === edge.id);
    if (lesson && s.lesson?.lesson_id === lesson.id) for (const id of lesson.repair_candidates) expect(pinned.has(id)).toBe(true);
  });

  it('never pins what a cut stops while its consequence is hidden', () => {
    const bundle = miniBundle();
    const ctx = createContext(bundle);
    const edge = bundle.graph.edges.find((e) => e.is_mutable_in_sandbox)!;
    const s = reduce(ctx, initialState(ctx, null), { type: 'unplug', edge_id: edge.id });
    const affected = s.consequences.flatMap((c) => c.affected_ids);
    expect(affected.length).toBeGreaterThan(0);
    const hidden = pinnedIds(ctx, s, false);
    for (const id of affected) expect(hidden.has(id), id).toBe(false);
    expect(hidden.has(edge.source_id)).toBe(true);
    for (const id of affected) expect(pinnedIds(ctx, s).has(id)).toBe(true);
  });

  it('visibleAtDetail is every shown tier plus anything pinned', () => {
    const bundle = miniBundle();
    const ctx = createContext(bundle);
    const s = { ...initialState(ctx, null), selected_id: bundle.graph.nodes[bundle.graph.nodes.length - 1]!.id };
    const all = visibleAtDetail(ctx, s, 'all');
    expect(all.size).toBe(bundle.graph.nodes.length);
    const key = visibleAtDetail(ctx, s, 'key');
    expect(key.has(s.selected_id)).toBe(true);
    for (const n of bundle.graph.nodes) if (detailTier(n) === 'key') expect(key.has(n.id)).toBe(true);
  });
});
