import { z } from 'zod';
import { Id } from './common.ts';
import { TruthStatus } from './truth.ts';

export const Consequence = z.object({
  edge_id: Id,
  /** Nodes that stop receiving the path's flow, in path order. */
  affected_ids: z.array(Id),
  /** The first node that fails (the answer to "what stops first?"). */
  first_affected_id: Id.nullable(),
  /** `observed` only when a recorded mutation run matches this edge; otherwise `inferred`. */
  truth_status: TruthStatus,
  evidence_ids: z.array(Id),
});
export type Consequence = z.infer<typeof Consequence>;

export const SceneState = z.object({
  system_id: Id,
  revision: z.string(),
  explode_factor: z.number().min(0).max(1),
  selected_id: Id.nullable(),
  focus_id: Id.nullable(),
  isolated_ids: z.array(Id).nullable(),
  highlighted_ids: z.array(Id),
  active_path_id: Id.nullable(),
  flow_animating: z.boolean(),
  broken_edge_ids: z.array(Id),
  consequences: z.array(Consequence),
  prediction: z.object({ target_id: Id, correct: z.boolean() }).nullable(),
  evidence_open_id: Id.nullable(),
  annotation: z.object({ target_id: Id, text: z.string() }).nullable(),
  question: z.string().nullable(),
  feedback: z.string().nullable(),
  misplug_count: z.number().int().nonnegative(),
  misconceptions: z.array(z.string()),
  lesson: z
    .object({
      lesson_id: Id,
      step_index: z.number().int().nonnegative(),
      status: z.enum(['active', 'complete', 'skipped']),
    })
    .nullable(),
});
export type SceneState = z.infer<typeof SceneState>;
