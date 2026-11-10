import { SystemGraph } from '@explode/contracts';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { PathSpec } from '../src/index.ts';
import { indexRepository } from '../src/index.ts';

const repoDemo = resolve(import.meta.dirname, '../../../content/repo-demo');
const fixture = resolve(repoDemo, 'fixture');
const paths = JSON.parse(readFileSync(resolve(repoDemo, 'paths.json'), 'utf8')) as PathSpec[];
const index = () => indexRepository({ root: fixture, systemId: 'system:auth-service', displayName: 'auth-service', paths });

describe('indexRepository', () => {
  const result = index();
  const { graph, evidence } = result;
  const nodeIds = new Set(graph.nodes.map((n) => n.id));
  const evidenceById = new Map(evidence.map((e) => [e.id, e]));

  it('produces a schema-valid graph with lowercase deterministic ids', () => {
    expect(() => SystemGraph.parse(graph)).not.toThrow();
    expect(JSON.stringify(index())).toBe(JSON.stringify(result));
  });

  it('finds clusters, modules, classes, methods and routes', () => {
    const kinds = (k: string) => graph.nodes.filter((n) => n.kind === k).map((n) => n.id);
    expect(kinds('cluster')).toEqual(expect.arrayContaining(['cluster:src/auth', 'cluster:src/http', 'cluster:src/sessions']));
    expect(kinds('module')).toContain('mod:src/auth/service.ts');
    expect(kinds('class')).toContain('class:src/auth/service.ts#authservice');
    expect(kinds('function')).toContain('fn:src/auth/service.ts#authservice.login');
    expect(kinds('route')).toEqual(['route:get:/me', 'route:post:/login', 'route:post:/logout']);
  });

  it('resolves every parent and edge endpoint', () => {
    for (const n of graph.nodes) if (n.parent_id !== null) expect(nodeIds.has(n.parent_id), n.id).toBe(true);
    for (const e of graph.edges) {
      expect(nodeIds.has(e.source_id), e.id).toBe(true);
      expect(nodeIds.has(e.target_id), e.id).toBe(true);
    }
  });

  it('builds the login path in order, with every hop backed by an edge into the next node', () => {
    const path = graph.paths.find((p) => p.id === 'path:login-request')!;
    expect(path.node_ids).toEqual(paths[0]!.node_ids);
    expect(path.edge_ids).toHaveLength(path.node_ids.length - 1);
    path.edge_ids.forEach((id, i) => {
      const edge = graph.edges.find((e) => e.id === id)!;
      expect(edge.target_id).toBe(path.node_ids[i + 1]);
      expect(path.node_ids.slice(0, i + 1)).toContain(edge.source_id);
    });
  });

  it('only creates call edges whose evidence shows the callee being called', () => {
    for (const e of graph.edges.filter((x) => x.relation === 'calls')) {
      const ev = evidenceById.get(e.evidence_ids[0]!);
      expect(ev?.kind).toBe('source_range');
      const callee = graph.nodes.find((n) => n.id === e.target_id)!.label.split('.').pop()!;
      if (ev?.kind === 'source_range') expect(ev.source.excerpt, e.id).toContain(callee);
    }
  });

  it('fails loudly when a path hop cannot be resolved', () => {
    const bad: PathSpec = { ...paths[0]!, node_ids: ['route:post:/login', 'fn:src/auth/tokens.ts#signtoken'] };
    expect(() => indexRepository({ root: fixture, systemId: 'system:x', displayName: 'x', paths: [bad] })).toThrow(/no resolved edge/);
  });

  it('records evidence excerpts that match the file at those lines', () => {
    for (const ev of evidence) {
      if (ev.kind !== 'source_range') continue;
      const lines = readFileSync(resolve(fixture, ev.source.path), 'utf8').split('\n');
      expect(ev.source.excerpt).toBe(lines.slice(ev.source.start_line - 1, ev.source.end_line).join('\n'));
      expect(ev.source.end_line - ev.source.start_line).toBeLessThan(12);
      expect(ev.source.revision).toBe(result.revision);
    }
  });
});
