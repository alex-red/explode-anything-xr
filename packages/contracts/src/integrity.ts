import type { ContentBundle } from './bundle.ts';
import type { Evidence } from './evidence.ts';
import { TRUTH_RANK, type TruthStatus } from './truth.ts';

/**
 * Referential and truth-contract checks that a schema alone cannot express.
 * Returns human-readable problems; an empty array means the bundle is consistent.
 */
export function checkBundleIntegrity(bundle: ContentBundle): string[] {
  const problems: string[] = [];
  const { graph, evidence, layout, lessons } = bundle;
  const nodeIds = new Set(graph.nodes.map((n) => n.id));
  const edgeIds = new Set(graph.edges.map((e) => e.id));
  const pathIds = new Set(graph.paths.map((p) => p.id));
  const evidenceById = new Map<string, Evidence>(evidence.map((e) => [e.id, e]));

  const dup = (kind: string, ids: string[]) => {
    const seen = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) problems.push(`duplicate ${kind} id ${id}`);
      seen.add(id);
    }
  };
  dup('node', graph.nodes.map((n) => n.id));
  dup('edge', graph.edges.map((e) => e.id));
  dup('path', graph.paths.map((p) => p.id));
  dup('evidence', evidence.map((e) => e.id));

  const checkEvidence = (owner: string, ids: string[], status: TruthStatus | null) => {
    let strongest = -1;
    for (const id of ids) {
      const ev = evidenceById.get(id);
      if (!ev) {
        problems.push(`${owner} cites missing evidence ${id}`);
        continue;
      }
      strongest = Math.max(strongest, TRUTH_RANK[ev.truth_status]);
    }
    // No silent promotion: a claim can't be stronger than its strongest evidence.
    if (status !== null && TRUTH_RANK[status] > TRUTH_RANK.inferred && TRUTH_RANK[status] > strongest) {
      problems.push(`${owner} claims ${status} but no cited evidence is that strong`);
    }
  };

  for (const n of graph.nodes) {
    if (n.parent_id !== null && !nodeIds.has(n.parent_id)) problems.push(`node ${n.id} has unknown parent ${n.parent_id}`);
    if (n.truth_status === 'observed' && !n.evidence_ids.some((id) => evidenceById.get(id)?.truth_status === 'observed')) {
      problems.push(`node ${n.id} is observed without observed evidence`);
    }
    checkEvidence(`node ${n.id}`, n.evidence_ids, n.truth_status);
  }
  for (const e of graph.edges) {
    if (!nodeIds.has(e.source_id)) problems.push(`edge ${e.id} has unknown source ${e.source_id}`);
    if (!nodeIds.has(e.target_id)) problems.push(`edge ${e.id} has unknown target ${e.target_id}`);
    if (e.truth_status === 'observed') problems.push(`edge ${e.id} must not be observed (edges are static or authored; see ADR-0007)`);
    checkEvidence(`edge ${e.id}`, e.evidence_ids, e.truth_status);
  }
  for (const p of graph.paths) {
    for (const id of p.node_ids) if (!nodeIds.has(id)) problems.push(`path ${p.id} has unknown node ${id}`);
    for (const id of p.edge_ids) if (!edgeIds.has(id)) problems.push(`path ${p.id} has unknown edge ${id}`);
    checkEvidence(`path ${p.id}`, p.evidence_ids, p.truth_status);
  }
  for (const ev of evidence) {
    if (ev.kind === 'mutation_run' && !edgeIds.has(ev.mutation.edge_id)) {
      problems.push(`mutation evidence ${ev.id} targets unknown edge ${ev.mutation.edge_id}`);
    }
    if (ev.kind === 'test_run') {
      for (const id of ev.executed_node_ids) if (!nodeIds.has(id)) problems.push(`test evidence ${ev.id} lists unknown node ${id}`);
    }
  }
  for (const id of nodeIds) if (!layout.placements[id]) problems.push(`node ${id} has no layout placement`);
  if (layout.system_id !== graph.system_id) problems.push('layout system_id mismatch');

  for (const lesson of lessons) {
    if (lesson.system_id !== graph.system_id) problems.push(`lesson ${lesson.id} targets another system`);
    if (lesson.break_edge_id && !edgeIds.has(lesson.break_edge_id)) problems.push(`lesson ${lesson.id} breaks unknown edge`);
    for (const id of lesson.repair_candidates) if (!nodeIds.has(id)) problems.push(`lesson ${lesson.id} offers unknown socket ${id}`);
    if (lesson.starts_broken) {
      const edge = graph.edges.find((e) => e.id === lesson.break_edge_id);
      if (!edge) problems.push(`lesson ${lesson.id} starts broken but has no break edge`);
      else if (!edge.is_mutable_in_sandbox) problems.push(`lesson ${lesson.id} starts with a non-sandbox edge broken`);
    }
    for (const step of lesson.steps) {
      const x = step.expect;
      if ('target_id' in x && !nodeIds.has(x.target_id)) problems.push(`step ${step.id} expects unknown node ${x.target_id}`);
      if ('path_id' in x && !pathIds.has(x.path_id)) problems.push(`step ${step.id} expects unknown path ${x.path_id}`);
      if ('edge_id' in x && !edgeIds.has(x.edge_id)) problems.push(`step ${step.id} expects unknown edge ${x.edge_id}`);
    }
  }
  return problems;
}
