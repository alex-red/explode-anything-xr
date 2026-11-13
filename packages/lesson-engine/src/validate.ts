import type { AssistantCommand, SceneAction, TutorPlan, TutorTurnRequest } from '@explode/contracts';
import { MAX_TUTOR_ACTIONS, TRUTH_RANK, TUTOR_ACTION_TYPES, TutorPlan as TutorPlanSchema } from '@explode/contracts';
import type { EngineContext } from './context.ts';

export type PlanValidation = { ok: true; plan: TutorPlan } | { ok: false; errors: string[] };

const ALLOWED: ReadonlySet<string> = new Set(TUTOR_ACTION_TYPES);

/**
 * What a plan's commands may touch: the buttons the learner can press right now and the systems
 * the app ships. `null` means the turn may not act at all (every turn except a question the
 * learner asked in their own words).
 */
export interface CommandScope {
  enabledButtons: ReadonlySet<string>;
  systems: ReadonlySet<string>;
}

/** The scope a request grants: none unless it is a `free_text` turn that says what is on screen. */
export function commandScopeOf(req: Pick<TutorTurnRequest, 'trigger' | 'view'>): CommandScope | null {
  if (req.trigger !== 'free_text' || !req.view) return null;
  return {
    enabledButtons: new Set(req.view.buttons.filter((b) => b.enabled).map((b) => b.id)),
    systems: new Set(req.view.systems.map((s) => s.id)),
  };
}

/**
 * Client-side validation of a tutor plan (the client is the only thing that executes actions).
 * Rejects the whole plan on any problem: schema, allowlist, unknown ids, truth promotion, or a
 * command outside `scope`.
 */
export function validateTutorPlan(ctx: EngineContext, input: unknown, scope: CommandScope | null = null): PlanValidation {
  const parsed = TutorPlanSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.map((i) => `${i.path.join('.') || 'plan'}: ${i.message}`) };
  }
  const plan = parsed.data;
  const errors: string[] = [];

  if (plan.actions.length > MAX_TUTOR_ACTIONS) errors.push(`too many actions (${plan.actions.length})`);
  plan.actions.forEach((a, i) => errors.push(...validateAction(ctx, a).map((m) => `actions.${i}: ${m}`)));

  if (plan.commands.length && !scope) errors.push('commands are only allowed when the learner asked in their own words');
  else if (scope) plan.commands.forEach((c, i) => errors.push(...validateCommand(ctx, c, scope).map((m) => `commands.${i}: ${m}`)));

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

export function validateCommand(ctx: EngineContext, c: AssistantCommand, scope: CommandScope): string[] {
  const errors: string[] = [];
  const node = (id: string) => {
    if (!ctx.nodes.has(id)) errors.push(`unknown node ${id}`);
  };
  switch (c.type) {
    case 'press':
      if (!scope.enabledButtons.has(c.button_id)) errors.push(`button ${c.button_id} is not there or not enabled`);
      break;
    case 'select':
    case 'predict':
      node(c.target_id);
      break;
    case 'trace':
      if (!ctx.paths.has(c.path_id)) errors.push(`unknown path ${c.path_id}`);
      break;
    case 'unplug': {
      const edge = ctx.edges.get(c.edge_id);
      if (!edge) errors.push(`unknown edge ${c.edge_id}`);
      else if (!edge.is_mutable_in_sandbox) errors.push(`edge ${c.edge_id} cannot be unplugged`);
      break;
    }
    case 'plug':
      if (!ctx.edges.has(c.edge_id)) errors.push(`unknown edge ${c.edge_id}`);
      node(c.target_id);
      break;
    case 'open_evidence':
      if (!ctx.evidence.has(c.evidence_id)) errors.push(`unknown evidence ${c.evidence_id}`);
      break;
    case 'open_system':
      if (!scope.systems.has(c.system_id)) errors.push(`unknown system ${c.system_id}`);
      break;
    default:
      break;
  }
  return errors;
}
