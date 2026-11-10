import type { Consequence, FlowPath } from '@explode/contracts';
import type { EngineContext } from './context.ts';

/**
 * Typed-flow propagation (ADR-0010): when an edge on a named path is disconnected,
 * every node after it on that path stops receiving the path's flow.
 *
 * Truth (ADR-0007):
 * - mechanical systems → `authored_model` (the teaching model's rule);
 * - software with a recorded mutation run for this edge → `observed`;
 * - otherwise → `inferred` (shown as a hypothesis, never as a failure).
 */
export function computeConsequence(ctx: EngineContext, edgeId: string): Consequence {
  const edge = ctx.edges.get(edgeId);
  if (!edge) throw new Error(`unknown edge ${edgeId}`);

  const affected: string[] = [];
  for (const path of ctx.paths.values()) {
    const at = path.edge_ids.indexOf(edgeId);
    if (at === -1) continue;
    for (const nodeId of downstreamOnPath(path, at)) if (!affected.includes(nodeId)) affected.push(nodeId);
  }
  if (affected.length === 0) affected.push(edge.target_id);

  let truth: Consequence['truth_status'] = 'inferred';
  const evidenceIds: string[] = [];
  if (ctx.bundle.graph.system_kind === 'mechanical') {
    truth = 'authored_model';
    evidenceIds.push(...edge.evidence_ids.filter((id) => ctx.evidence.get(id)?.kind === 'authored_rule'));
  } else {
    for (const ev of ctx.evidence.values()) {
      if (ev.kind === 'mutation_run' && ev.mutation.edge_id === edgeId && ev.run.failed > 0) {
        truth = 'observed';
        evidenceIds.push(ev.id);
      }
    }
  }
  return {
    edge_id: edgeId,
    affected_ids: affected,
    first_affected_id: affected[0] ?? null,
    truth_status: truth,
    evidence_ids: evidenceIds,
  };
}

function downstreamOnPath(path: FlowPath, edgeIndex: number): string[] {
  // edge_ids[i] carries flow into node_ids[i+1] (its source is the nearest earlier node, not always node_ids[i])
  return path.node_ids.slice(edgeIndex + 1);
}

/** Nodes on a path that are currently receiving flow, given the broken edges. */
export function liveNodesOnPath(path: FlowPath, brokenEdgeIds: readonly string[]): string[] {
  const firstBreak = path.edge_ids.findIndex((id) => brokenEdgeIds.includes(id));
  return firstBreak === -1 ? [...path.node_ids] : path.node_ids.slice(0, firstBreak + 1);
}
