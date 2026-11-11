import { z } from 'zod';
import { Id } from './common.ts';
import { SceneAction } from './actions.ts';

/** What the learner must do to complete a step. Evaluated only by the lesson engine. */
export const Expectation = z.discriminatedUnion('type', [
  /** Advance with the Next button. */
  z.object({ type: z.literal('next') }),
  z.object({ type: z.literal('explode_at_least'), factor: z.number().min(0).max(1) }),
  z.object({ type: z.literal('collapse_below'), factor: z.number().min(0).max(1) }),
  z.object({ type: z.literal('select'), target_id: Id }),
  z.object({ type: z.literal('trace'), path_id: Id }),
  z.object({ type: z.literal('unplug'), edge_id: Id }),
  z.object({ type: z.literal('predict') }),
  z.object({ type: z.literal('repair'), edge_id: Id }),
  z.object({ type: z.literal('open_evidence') }),
]);
export type Expectation = z.infer<typeof Expectation>;

export const LessonStep = z.object({
  id: Id,
  kind: z.enum(['intro', 'explode', 'trace', 'predict', 'break', 'observe', 'explain', 'repair', 'reflect', 'transition']),
  caption: z.string().min(1).max(280),
  /** Id of a pre-rendered narration clip (optional; captions are always shown). */
  narration_id: z.string().optional(),
  expect: Expectation,
  /** Actions applied when the step becomes active. */
  on_enter: z.array(SceneAction).max(6).default([]),
  hint: z.string().max(200).optional(),
  /** Used by predict steps. */
  feedback: z.object({ correct: z.string().max(240), incorrect: z.string().max(240) }).optional(),
});
export type LessonStep = z.infer<typeof LessonStep>;

export const Lesson = z.object({
  id: Id,
  system_id: Id,
  title: z.string().max(80),
  objectives: z.array(z.string().max(160)).min(1),
  /** The edge the learner breaks; consequences are computed from it. */
  break_edge_id: Id.optional(),
  /** Candidate sockets offered during repair. Exactly one is the edge's real target. */
  repair_candidates: z.array(Id).max(4).default([]),
  /**
   * An incident drill: the lesson starts with `break_edge_id` already cut, and the learner finds
   * and repairs it. Only the lesson engine cuts it, exactly as an unplug would.
   */
  starts_broken: z.boolean().optional(),
  /** Misconception tag recorded when a prediction is wrong. */
  misconception_on_wrong_prediction: z.string().optional(),
  steps: z.array(LessonStep).min(1),
});
export type Lesson = z.infer<typeof Lesson>;
