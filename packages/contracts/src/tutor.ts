import { z } from 'zod';
import { Id } from './common.ts';
import { SceneAction, MAX_TUTOR_ACTIONS } from './actions.ts';
import { EngineEvent } from './events.ts';
import { TruthStatus } from './truth.ts';

export const TutorTrigger = z.enum(['explain_selection', 'why_failed', 'what_depends', 'hint', 'free_text']);
export type TutorTrigger = z.infer<typeof TutorTrigger>;

export const TutorTurnRequest = z.object({
  system_id: Id,
  revision: z.string(),
  trigger: TutorTrigger,
  selected_id: Id.nullable(),
  lesson_id: Id.nullable(),
  step_id: Id.nullable(),
  broken_edge_ids: z.array(Id).max(10),
  recent_events: z.array(EngineEvent).max(10),
  free_text: z.string().max(300).optional(),
});
export type TutorTurnRequest = z.infer<typeof TutorTurnRequest>;

/** One structured response per turn (ADR-0011). Validated again on the client before execution. */
export const TutorPlan = z.object({
  say: z.string().min(1).max(400),
  /** Strength of the main claim in `say`. */
  claim_status: TruthStatus,
  evidence_ids: z.array(Id).max(6),
  actions: z.array(SceneAction).max(MAX_TUTOR_ACTIONS),
  /** True when the tutor declines because evidence is missing. */
  abstain: z.boolean(),
});
export type TutorPlan = z.infer<typeof TutorPlan>;

export const TutorTurnResponse = z.object({
  plan: TutorPlan,
  source: z.enum(['live', 'scripted']),
  model: z.string().optional(),
});
export type TutorTurnResponse = z.infer<typeof TutorTurnResponse>;

/** JSON Schema of the plan, used as the LLM's structured-output schema. */
export function tutorPlanJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(TutorPlan, { target: 'draft-2020-12' }) as Record<string, unknown>;
}
