import type { SceneAction, TutorPlan } from '@explode/contracts';
import { MAX_TUTOR_ACTIONS, TRUTH_RANK, TUTOR_ACTION_TYPES, TutorPlan as TutorPlanSchema } from '@explode/contracts';
import type { EngineContext } from './context.ts';

export type PlanValidation = { ok: true; plan: TutorPlan } | { ok: false; errors: string[] };

const ALLOWED: ReadonlySet<string> = new Set(TUTOR_ACTION_TYPES);

/**
 * Client-side validation of a tutor plan (the client is the only thing that executes actions).
 * Rejects the whole plan on any problem: schema, allowlist, unknown ids, or truth promotion.
 */
export function validateTutorPlan(ctx: EngineContext, input: unknown): PlanValidation {
  const parsed = TutorPlanSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.map((i) => `${i.path.join('.') || 'plan'}: ${i.message}`) };
  }
  const plan = parsed.data;
  const errors: string[] = [];

  if (plan.actions.length > MAX_TUTOR_ACTIONS) errors.push(`too many actions (${plan.actions.length})`);
  plan.actions.forEach((a, i) => errors.push(...validateAction(ctx, a).map((m) => `actions.${i}: ${m}`)));

  let strongest = -1;
  for (const id of plan.evidence_ids) {
    const ev = ctx.evidence.get(id);
    if (!ev) errors.push(`evidence_ids: unknown evidence ${id}`);
    else strongest = Math.max(strongest, TRUTH_RANK[ev.truth_status]);
  }
  if (!plan.abstain && TRUTH_RANK[plan.claim_status] > TRUTH_RANK.inferred && TRUTH_RANK[plan.claim_status] > strongest) {
    errors.push(`claim_status ${plan.claim_status} is not supported by the cited evidence`);
  }
  return errors.length ? { ok: false, errors } : { ok: true, plan };
}

export function validateAction(ctx: EngineContext, a: SceneAction): string[] {
  const errors: string[] = [];
  if (!ALLOWED.has(a.type)) errors.push(`action ${a.type} is not allowed for the tutor`);
  const node = (id: string) => {
    if (!ctx.nodes.has(id)) errors.push(`unknown node ${id}`);
  };
  switch (a.type) {
    case 'focus':
    case 'show_annotation':
      node(a.target_id);
      break;
    case 'isolate':
    case 'highlight':
      a.target_ids.forEach(node);
      break;
    case 'highlight_path':
    case 'animate_flow':
      if (!ctx.paths.has(a.path_id)) errors.push(`unknown path ${a.path_id}`);
      break;
    case 'show_evidence':
      if (!ctx.evidence.has(a.evidence_id)) errors.push(`unknown evidence ${a.evidence_id}`);
      break;
    default:
      break;
  }
  return errors;
}
