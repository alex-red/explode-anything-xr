import type { ContentBundle } from '@explode/contracts';
import { sha256 } from '@explode/indexer';
import { createContext, detailTier } from '@explode/lesson-engine';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  SDK_BUDGET,
  buildDigest,
  buildSdkBundle,
  curationProblems,
  indexSdk,
  layoutProblems,
  partGraph,
  sdkCuration,
  sdkSource,
  selectSdk,
  targetOverlaps,
  verifyBundle,
} from '../src/index.ts';
import { IWSDK_BUNDLE_PATH, IWSDK_DIR } from '../src/paths.ts';

const sdk = JSON.parse(readFileSync(IWSDK_BUNDLE_PATH, 'utf8')) as ContentBundle;
const index = indexSdk();
const pg = partGraph(index);
const curation = sdkCuration();
const source = sdkSource();

describe('the SDK bundle', () => {
  it('passes schema, integrity, layout and hash checks, and no two ray targets overlap', () => {
    expect(verifyBundle(sdk)).toEqual([]);
    expect(layoutProblems(sdk.layout)).toEqual([]);
    expect(targetOverlaps(sdk.graph, sdk.layout)).toEqual([]);
  });

  it('is up to date with the vendored source, the curation and the generator', () => {
    expect(sdk.graph.revision).toEqual({ kind: 'git', value: source.commit });
    expect(curation.source.commit).toBe(source.commit);
    expect(buildSdkBundle(sdk).content_hash).toBe(sdk.content_hash);
  });

  it('draws a small, bounded part of what was indexed', () => {
    const { stats } = selectSdk().selection;
    expect(stats.indexed.declarations).toBeGreaterThan(1000);
    expect(stats.shown.parts).toBeLessThanOrEqual(SDK_BUDGET.budget);
    expect(stats.shown.connections).toBeLessThanOrEqual(SDK_BUDGET.maxEdges);
    for (const g of stats.groups) {
      expect(g.shown, `${g.id} shows something`).toBeGreaterThanOrEqual(Math.min(SDK_BUDGET.perGroupMin, g.parts));
      expect(g.shown).toBeLessThanOrEqual(SDK_BUDGET.perGroupMax);
    }
    expect(sdk.graph.nodes.length).toBe(stats.shown.parts + stats.shown.groups);
    // Three detail tiers, each with something in it, so the detail level still thins the view.
    const tiers = sdk.graph.nodes.map((n) => detailTier(n));
    for (const t of ['key', 'supporting', 'extra'] as const) expect(tiers.filter((x) => x === t).length, t).toBeGreaterThan(5);
  });
});

describe('the SDK bundle keeps the truth contract', () => {
  it('marks every curated group a hypothesis that cites nothing', () => {
    const groups = sdk.graph.nodes.filter((n) => n.kind === 'cluster');
    expect(groups.map((g) => g.label)).toEqual(expect.arrayContaining(curation.groups.map((g) => g.label)));
    expect(groups).toHaveLength(curation.groups.length);
    for (const g of groups) {
      expect(g.truth_status).toBe('inferred');
      expect(g.evidence_ids).toEqual([]);
      expect(g.role).toBe('concept');
    }
  });

  it('quotes every part and connection from the vendored source, line for line', () => {
    const evidence = new Map(sdk.evidence.map((e) => [e.id, e]));
    const lines = new Map<string, string[]>();
    const read = (path: string) => {
      if (!lines.has(path)) lines.set(path, readFileSync(resolve(IWSDK_DIR, 'source', path), 'utf8').split('\n'));
      return lines.get(path)!;
    };
    const claims = [...sdk.graph.nodes.filter((n) => n.kind !== 'cluster'), ...sdk.graph.edges];
    expect(claims.length).toBeGreaterThan(80);
    for (const c of claims) {
      expect(c.truth_status, c.id).toBe('static_verified');
      expect(c.evidence_ids.length, `${c.id} cites its source`).toBeGreaterThan(0);
      for (const id of c.evidence_ids) {
        const ev = evidence.get(id)!;
        expect(ev.kind).toBe('source_range');
        if (ev.kind !== 'source_range') continue;
        const { path, start_line, end_line, excerpt, excerpt_sha256, revision } = ev.source;
        expect(revision).toBe(source.commit);
        expect(read(path).slice(start_line - 1, end_line).join('\n'), `${id} matches ${path}:${start_line}`).toBe(excerpt);
        expect(sha256(excerpt)).toBe(excerpt_sha256);
      }
    }
  });

  it('claims nothing was observed, and offers nothing to unplug or repair', () => {
    expect(sdk.graph.nodes.some((n) => n.truth_status === 'observed')).toBe(false);
    expect(sdk.graph.edges.some((e) => e.truth_status === 'observed' || e.is_mutable_in_sandbox)).toBe(false);
    expect(sdk.evidence.some((e) => e.kind === 'test_run' || e.kind === 'mutation_run')).toBe(false);
    for (const l of sdk.lessons) {
      expect(l.break_edge_id).toBeUndefined();
      expect(l.steps.some((s) => ['unplug', 'repair', 'predict'].includes(s.expect.type))).toBe(false);
    }
  });

  it('every connection drawn stands for a call or construction between those two parts in the index', () => {
    for (const e of sdk.graph.edges) {
      const link = pg.links.find((l) => l.source === e.source_id && l.target === e.target_id);
      expect(link, e.id).toBeDefined();
      expect(link!.edges.map((x) => x.evidence_ids[0])).toContain(e.evidence_ids[0]);
    }
  });

  it('traces a path whose every hop is a drawn connection, in order', () => {
    const ctx = createContext(sdk);
    const path = sdk.graph.paths[0]!;
    path.edge_ids.forEach((id, i) => {
      const e = ctx.edges.get(id)!;
      expect(e.target_id).toBe(path.node_ids[i + 1]);
      expect(path.node_ids.slice(0, i + 1)).toContain(e.source_id);
    });
  });

  it('says in the lesson only what the index and the curation record', () => {
    const { stats } = selectSdk().selection;
    const text = sdk.lessons[0]!.steps.map((s) => s.caption).join(' ');
    expect(text).toContain(`${stats.indexed.files} files, ${stats.indexed.declarations} declarations`);
    expect(text).toContain(`${stats.shown.parts} of ${stats.indexed.parts} classes and functions`);
    expect(text).toContain(`(${curation.produced_by.model})`);
    expect(text).toMatch(/hypothesis/);
  });
});

describe('relevance', () => {
  it('folds methods into their class and ranks from calls across files', () => {
    for (const p of pg.parts.values()) expect(p.label.includes('.'), `${p.label} is a class or a top-level function`).toBe(false);
    const world = pg.parts.get('class:packages/core/src/ecs/world.ts#world')!;
    expect(world.callers).toBeGreaterThan(10);
    const top = [...pg.parts.values()].sort((a, b) => b.score - a.score).slice(0, 10);
    expect(top).toContain(world);
    for (const p of pg.parts.values()) {
      expect(p.score).toBeGreaterThanOrEqual(0);
      expect(p.score).toBeLessThanOrEqual(1);
    }
  });

  it('gives roles from structure: engines have a per-frame update and no caller in the repository', () => {
    for (const n of sdk.graph.nodes) {
      const part = pg.parts.get(n.id);
      if (n.role === 'engine') expect(part!.has_update && part!.callers === 0, n.label).toBe(true);
      if (n.role === 'entry') expect(curation.entry_points).toContain(n.id);
      if (n.role === 'hub') expect(sdk.graph.edges.filter((e) => e.target_id === n.id).length, n.label).toBeGreaterThanOrEqual(3);
    }
    expect(sdk.graph.nodes.filter((n) => n.role === 'hub').length).toBeGreaterThan(0);
    expect(sdk.graph.nodes.filter((n) => n.role === 'engine').length).toBeGreaterThan(0);
  });

  it('the committed curation fits the index, and was made from the digest this index gives', () => {
    expect(curationProblems(curation, pg)).toEqual([]);
    expect(curation.produced_by.digest_sha256).toBe(sha256(buildDigest(pg).text));
  });

  it('rejects a curation that names things the index does not have', () => {
    const bad = {
      ...curation,
      groups: [...curation.groups.slice(1), { ...curation.groups[0]!, members: ['packages/core/src/no-such-dir'] }],
      spotlight: [{ id: 'class:nope.ts#nope', why: 'not there' }],
      entry_points: ['fn:nope.ts#nope'],
    };
    const problems = curationProblems(bad, pg);
    expect(problems.some((p) => p.includes('matches no indexed part'))).toBe(true);
    expect(problems.some((p) => p.includes('spotlight'))).toBe(true);
    expect(problems.some((p) => p.includes('entry point'))).toBe(true);
  });
});
