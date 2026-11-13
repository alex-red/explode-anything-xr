import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { buildFromCuration, deriveChain, indexAnyRepo, layoutProblems, repoSystemId, targetOverlaps, tooSmall, usableCuration, verifyBundle, workspacePaths, Curation } from '../src/index.ts';
import { IWSDK_DIR } from '../src/paths.ts';
import { FIXTURE_ANSWER, FIXTURE_FILES, FIXTURE_SOURCE, writeFixture } from './any-repo-fixture.ts';

const dirs: string[] = [];
const temp = () => {
  const dir = mkdtempSync(join(tmpdir(), 'any-repo-test-'));
  dirs.push(dir);
  return dir;
};
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

const BY = { provider: 'test', model: 'test-model-1', created_at: '2026-11-13T00:00:00.000Z' };
const root = temp();
writeFixture(root);
const repo = indexAnyRepo(root, FIXTURE_SOURCE);

describe('indexing a repository nobody prepared', () => {
  it('gives every id the contract form, whatever the path or name looks like', () => {
    for (const n of repo.index.graph.nodes) expect(n.id).toMatch(/^[a-z0-9][a-z0-9._:/#@>-]*$/);
    expect(repo.pg.parts.has('class:src/api/server.ts#server')).toBe(true);
    expect(repo.pg.parts.has('fn:src/util/log.ts#-stamp')).toBe(true);
    expect(repoSystemId(FIXTURE_SOURCE)).toBe('system:gh/example-org/fixture.shop@c0ffee123456');
  });

  it('cites the real path, not the lowercased one', () => {
    const ev = repo.index.evidence.find((e) => e.id === 'ev:src:class:src/api/server.ts#server');
    expect(ev?.kind === 'source_range' && ev.source.path).toBe('src/Api/Server.ts');
    expect(ev?.kind === 'source_range' && ev.source.revision).toBe(FIXTURE_SOURCE.commit);
    expect(ev?.kind === 'source_range' && FIXTURE_FILES['src/Api/Server.ts']!.includes(ev.source.excerpt)).toBe(true);
  });

  it('resolves imports with no extension, with .js, and through a tsconfig alias', () => {
    const calls = (from: string, to: string) => repo.pg.links.some((l) => l.source === from && l.target === to);
    expect(calls('class:src/api/server.ts#server', 'class:src/core/router.ts#router')).toBe(true); // '../core/router'
    expect(calls('class:src/api/server.ts#server', 'fn:src/util/config.ts#loadconfig')).toBe(true); // '../util/config.js'
    expect(calls('fn:src/api/handlers.ts#handlelogout', 'fn:src/store/sessions.ts#endsession')).toBe(true); // '@store/sessions'
    expect(workspacePaths(root)).toEqual({ '@store/*': ['src/store/*'] });
  });

  it('reads a function held in a const, with its calls in and out, and leaves other consts alone', () => {
    const calls = (from: string, to: string) => repo.pg.links.some((l) => l.source === from && l.target === to);
    const format = repo.pg.parts.get('fn:src/util/format.ts#formatname')!;
    expect(format).toMatchObject({ kind: 'function', label: 'formatName', exported: true, doc: 'Written the modern way: a function held in a const.' });
    expect(repo.pg.parts.get('fn:src/util/format.ts#trim')).toMatchObject({ exported: false });
    expect(repo.pg.parts.has('fn:src/util/format.ts#version')).toBe(false);
    expect(calls('fn:src/api/handlers.ts#handlelogin', 'fn:src/util/format.ts#formatname')).toBe(true); // called from elsewhere
    expect(calls('fn:src/util/format.ts#formatname', 'fn:src/util/log.ts#log')).toBe(true); // calls out
    expect(calls('fn:src/util/format.ts#formatname', 'fn:src/util/format.ts#trim')).toBe(true); // a function expression
    const ev = repo.index.evidence.find((e) => e.id === 'ev:src:fn:src/util/format.ts#formatname');
    expect(ev?.kind === 'source_range' && ev.source.excerpt.startsWith('export const formatName = (name: string): string => {')).toBe(true);
  });

  it('never reads a test file', () => {
    expect(repo.index.graph.nodes.some((n) => n.id.includes('auth.test') || n.label === 'neverIndexed')).toBe(false);
  });

  it('counts what it read', () => {
    expect(repo.counts).toEqual({ files: 11, declarations: 18, parts: 16, connections: repo.pg.links.length });
    expect(tooSmall(repo)).toBeNull();
  });

  it('says so when there is too little to explode', () => {
    const small = temp();
    writeFixture(small, { 'src/a.ts': 'export function a() { return 1; }\n', 'src/b.ts': 'export function b() { return 2; }\n' });
    expect(tooSmall(indexAnyRepo(small, FIXTURE_SOURCE))).toMatch(/Only 2 classes and functions in 2 files/);
  });
});

describe('building from a model answer', () => {
  const built = buildFromCuration(repo, FIXTURE_SOURCE, JSON.stringify(FIXTURE_ANSWER), BY);
  if (!built.ok) throw new Error(built.problems.join('\n'));
  const { bundle, stats } = built.result;

  it('passes schema, integrity, layout and hash checks, and no two ray targets overlap', () => {
    expect(verifyBundle(bundle)).toEqual([]);
    expect(layoutProblems(bundle.layout)).toEqual([]);
    expect(targetOverlaps(bundle.graph, bundle.layout)).toEqual([]);
  });

  it('keeps the truth contract: source is static, the groups are a hypothesis, nothing is observed', () => {
    const { nodes, edges, paths } = bundle.graph;
    const groups = nodes.filter((n) => n.role === 'concept');
    expect(groups).toHaveLength(4);
    for (const g of groups) expect(g).toMatchObject({ truth_status: 'inferred', evidence_ids: [] });
    for (const n of nodes.filter((x) => x.role !== 'concept')) {
      expect(n.truth_status).toBe('static_verified');
      expect(n.evidence_ids.length).toBeGreaterThan(0);
    }
    for (const e of edges) expect(e).toMatchObject({ truth_status: 'static_verified', is_mutable_in_sandbox: false });
    for (const p of paths) expect(p.truth_status).toBe('static_verified');
    expect(bundle.evidence.some((e) => e.truth_status === 'observed')).toBe(false);
    // The licence is GitHub's reading, not something this build checked.
    expect(bundle.evidence.find((e) => e.id === 'ev:license:source')).toMatchObject({ truth_status: 'inferred', license: { spdx: 'MIT' } });
    expect(bundle.graph.revision).toEqual({ kind: 'git', value: FIXTURE_SOURCE.commit });
  });

  it('draws only one of two parts with the same name, and keeps the one the model singled out', () => {
    const queries = bundle.graph.nodes.filter((n) => n.label === 'query');
    expect(queries.map((n) => n.id)).toEqual(['fn:src/store/db.ts#query']);
    expect(stats.shown.parts).toBe(15);
  });

  it('traces a chain in which every hop is a call in the source', () => {
    const path = bundle.graph.paths[0]!;
    expect(path.node_ids[0]).toBe('class:src/api/server.ts#server');
    expect(path.node_ids.length).toBeGreaterThanOrEqual(4);
    path.edge_ids.forEach((id, i) => {
      const edge = bundle.graph.edges.find((e) => e.id === id)!;
      expect(edge.target_id).toBe(path.node_ids[i + 1]);
      expect(path.node_ids.slice(0, i + 1)).toContain(edge.source_id);
      const ev = bundle.evidence.find((e) => e.id === edge.evidence_ids[0])!;
      expect(ev.kind).toBe('source_range');
    });
  });

  it('writes a tour whose figures are counted, and that names the model and says nothing was run', () => {
    const lesson = bundle.lessons[0]!;
    expect(lesson.break_edge_id).toBeUndefined();
    const text = lesson.steps.map((s) => s.caption).join(' ');
    expect(text).toContain('Example-Org/Fixture.Shop');
    expect(text).toContain('commit c0ffee1');
    expect(text).toContain('11 files, 18 declarations');
    expect(text).toContain('test-model-1');
    expect(text).toContain('None of it was run');
    expect(lesson.steps.every((s) => s.caption.length <= 280)).toBe(true);
    expect(lesson.steps.some((s) => s.expect.type === 'unplug' || s.expect.type === 'repair')).toBe(false);
  });

  it('is the same bundle when built again from the same answer', () => {
    const again = buildFromCuration(repo, FIXTURE_SOURCE, JSON.stringify(FIXTURE_ANSWER), BY);
    expect(again.ok && again.result.bundle.content_hash).toBe(bundle.content_hash);
  });
});

describe('a model answer that does not fit', () => {
  const problems = (answer: unknown) => {
    const out = buildFromCuration(repo, FIXTURE_SOURCE, typeof answer === 'string' ? answer : JSON.stringify(answer), BY);
    return out.ok ? [] : out.problems;
  };

  it('is refused with the reason, never repaired', () => {
    expect(problems('not json at all')[0]).toMatch(/^not JSON/);
    expect(problems({ ...FIXTURE_ANSWER, groups: FIXTURE_ANSWER.groups.slice(0, 2) }).join(' ')).toMatch(/groups/);
    expect(problems({ ...FIXTURE_ANSWER, spotlight: [{ id: 'fn:src/made/up.ts#nothing', why: 'It does not exist.' }] })).toEqual(['spotlight fn:src/made/up.ts#nothing is not an indexed part']);
    expect(problems({ ...FIXTURE_ANSWER, entry_points: ['class:src/Api/Server.ts#Server'] })).toEqual(['entry point class:src/Api/Server.ts#Server is not an indexed part']);
    const moved = structuredClone(FIXTURE_ANSWER);
    moved.groups[0]!.members = ['lib/nowhere'];
    expect(problems(moved)).toEqual(['group entry: member lib/nowhere matches no indexed part']);
  });

  it('cannot set a truth status or add evidence: unknown fields are dropped', () => {
    const sneaky = structuredClone(FIXTURE_ANSWER) as Record<string, unknown> & typeof FIXTURE_ANSWER;
    (sneaky.groups[0] as Record<string, unknown>).truth_status = 'observed';
    (sneaky.groups[0] as Record<string, unknown>).evidence_ids = ['ev:src:mod:src/store/db.ts'];
    sneaky.observed = true;
    const out = buildFromCuration(repo, FIXTURE_SOURCE, JSON.stringify(sneaky), BY);
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.result.bundle.graph.nodes.find((n) => n.id === 'concept:entry')).toMatchObject({ truth_status: 'inferred', evidence_ids: [] });
  });
});

describe('choosing what must be shown', () => {
  const curation = Curation.parse({
    schema_version: '1',
    source: { repository: FIXTURE_SOURCE.url, commit: FIXTURE_SOURCE.commit },
    produced_by: { ...BY, digest_sha256: repo.digest.sha256 },
    ...FIXTURE_ANSWER,
    spotlight: [...FIXTURE_ANSWER.spotlight, { id: 'fn:src/util/query.ts#query', why: 'Same name as the other query.' }],
  });

  it('drops a singled-out part that shares a name with one kept earlier', () => {
    expect(usableCuration(curation, repo.pg).spotlight.map((s) => s.id)).toEqual(['fn:src/core/auth.ts#authenticate', 'fn:src/store/db.ts#query']);
  });

  it('starts the chain at the entry point and never repeats a name', () => {
    const chain = deriveChain(usableCuration(curation, repo.pg), repo.pg)!;
    expect(chain.node_ids[0]).toBe('class:src/api/server.ts#server');
    const labels = chain.node_ids.map((id) => repo.pg.parts.get(id)!.label);
    expect(new Set(labels).size).toBe(labels.length);
    for (let i = 1; i < chain.node_ids.length; i++) {
      expect(repo.pg.links.some((l) => l.source === chain.node_ids[i - 1] && l.target === chain.node_ids[i])).toBe(true);
    }
  });
});

describe('the same builder on a real repository (the vendored SDK copy)', () => {
  it('builds a valid bundle from the committed curation, with no hand-made path', () => {
    const source = JSON.parse(readFileSync(resolve(IWSDK_DIR, 'SOURCE.json'), 'utf8')) as { commit: string };
    const committed = JSON.parse(readFileSync(resolve(IWSDK_DIR, 'curation.json'), 'utf8')) as { groups: unknown; spotlight: unknown; entry_points: unknown };
    const sdkSource = { full_name: 'meta/immersive-web-sdk', url: 'https://github.com/meta/immersive-web-sdk', commit: source.commit, license: { spdx: 'MIT', name: 'MIT License' } };
    const sdk = indexAnyRepo(resolve(IWSDK_DIR, 'source'), sdkSource);
    expect(sdk.counts.files).toBe(195);
    const out = buildFromCuration(sdk, sdkSource, JSON.stringify({ groups: committed.groups, spotlight: committed.spotlight, entry_points: committed.entry_points }), BY);
    if (!out.ok) throw new Error(out.problems.join('\n'));
    const { bundle } = out.result;
    expect(verifyBundle(bundle)).toEqual([]);
    expect(targetOverlaps(bundle.graph, bundle.layout)).toEqual([]);
    expect(bundle.graph.paths[0]!.node_ids.length).toBeGreaterThanOrEqual(3);
    expect(bundle.graph.nodes.filter((n) => n.role !== 'concept').length).toBeLessThanOrEqual(46);
  });
});
