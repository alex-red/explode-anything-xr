import type { SceneState, TutorPlan, TutorTurnRequest } from '@explode/contracts';
import { TRUTH_LABEL } from '@explode/contracts';
import type { EngineContext } from './context.ts';
import { computeConsequence } from './propagation.ts';
import { currentStep } from './reducer.ts';

/**
 * Deterministic, offline tutor. It is the default (ADR-0011) and the fallback when the
 * live proxy is unavailable, slow, or returns an invalid plan. Every answer is derived from
 * graph facts, so it can never cite something that does not exist.
 */
export function scriptedTutorTurn(ctx: EngineContext, state: SceneState, req: Pick<TutorTurnRequest, 'trigger' | 'selected_id'>): TutorPlan {
  switch (req.trigger) {
    case 'explain_selection':
      return explainSelection(ctx, req.selected_id ?? state.selected_id);
    case 'what_depends':
      return whatDepends(ctx, req.selected_id ?? state.selected_id);
    case 'why_failed':
      return whyFailed(ctx, state);
    case 'hint':
      return hint(ctx, state);
    case 'free_text':
      return abstain('Live questions need the online tutor. Try "Explain this" on a selected part instead.');
  }
}

function explainSelection(ctx: EngineContext, id: string | null): TutorPlan {
  const node = id ? ctx.nodes.get(id) : undefined;
  if (!node) return abstain('Select a part first, then ask me to explain it.');
  const out = ctx.outgoing.get(node.id) ?? [];
  const neighbors = out.map((e) => e.target_id).filter((t) => ctx.nodes.has(t)).slice(0, 5);
  const evidence = node.evidence_ids.slice(0, 2);
  const status = TRUTH_LABEL[node.truth_status].toLowerCase();
  const reach = neighbors.length
    ? ` It connects to ${neighbors.map((n) => ctx.nodes.get(n)!.label).join(', ')}.`
    : '';
  return {
    say: `${node.label}: ${node.summary || 'no summary recorded.'}${reach} (Evidence: ${status}.)`,
    claim_status: node.truth_status,
    evidence_ids: evidence,
    actions: [
      { type: 'focus', target_id: node.id },
      ...(neighbors.length ? [{ type: 'highlight' as const, target_ids: [node.id, ...neighbors] }] : []),
      ...(evidence[0] ? [{ type: 'show_evidence' as const, evidence_id: evidence[0] }] : []),
    ],
    abstain: false,
  };
}

function whatDepends(ctx: EngineContext, id: string | null): TutorPlan {
  const node = id ? ctx.nodes.get(id) : undefined;
  if (!node) return abstain('Select a part first, then ask what depends on it.');
  const incoming = (ctx.incoming.get(node.id) ?? []).filter((e) => ctx.nodes.has(e.source_id));
  if (incoming.length === 0) {
    return { say: `Nothing in this graph depends on ${node.label}.`, claim_status: 'static_verified', evidence_ids: [], actions: [{ type: 'focus', target_id: node.id }], abstain: false };
  }
  const sources = [...new Set(incoming.map((e) => e.source_id))].slice(0, 8);
  const evidence = incoming.flatMap((e) => e.evidence_ids).slice(0, 3);
  const strongest = incoming.some((e) => e.truth_status === 'static_verified') ? 'static_verified' : incoming[0]!.truth_status;
  return {
    say: `${sources.length} part${sources.length === 1 ? '' : 's'} depend on ${node.label}: ${sources.map((s) => ctx.nodes.get(s)!.label).join(', ')}.`,
    claim_status: strongest,
    evidence_ids: evidence,
    actions: [{ type: 'highlight', target_ids: [node.id, ...sources] }],
    abstain: false,
  };
}

function whyFailed(ctx: EngineContext, state: SceneState): TutorPlan {
  const edgeId = state.broken_edge_ids[0];
  if (!edgeId) return abstain('Nothing is disconnected right now. Unplug a connection first.');
  const c = state.consequences.find((x) => x.edge_id === edgeId) ?? computeConsequence(ctx, edgeId);
  const edge = ctx.edges.get(edgeId)!;
  const src = ctx.nodes.get(edge.source_id)!.label;
  const dst = ctx.nodes.get(edge.target_id)!.label;
  const first = c.first_affected_id ? ctx.nodes.get(c.first_affected_id)?.label : undefined;
  const qualifier =
    c.truth_status === 'observed'
      ? 'A recorded test run confirms it: with this connection removed, the tests fail.'
      : c.truth_status === 'authored_model'
        ? 'This is the teaching model, not a measurement of a real vehicle.'
        : 'This is a hypothesis from the graph. No recorded test confirms it.';
  return {
    say: `${src} can no longer reach ${dst}, so ${first ?? dst} stops first and everything after it on the path goes dark. ${qualifier}`,
    claim_status: c.truth_status,
    evidence_ids: c.evidence_ids.slice(0, 3),
    actions: [
      { type: 'highlight', target_ids: [edge.source_id, ...c.affected_ids].slice(0, 12) },
      ...(c.evidence_ids[0] ? [{ type: 'show_evidence' as const, evidence_id: c.evidence_ids[0] }] : []),
    ],
    abstain: false,
  };
}

function hint(ctx: EngineContext, state: SceneState): TutorPlan {
  const step = currentStep(ctx, state);
  if (!step) return abstain('No active lesson step. Explore freely, or press Reset to start again.');
  return { say: step.hint ?? step.caption, claim_status: 'unknown', evidence_ids: [], actions: [], abstain: false };
}

function abstain(say: string): TutorPlan {
  return { say, claim_status: 'unknown', evidence_ids: [], actions: [], abstain: true };
}
