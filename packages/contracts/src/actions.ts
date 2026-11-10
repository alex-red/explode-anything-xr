import { z } from 'zod';
import { Id } from './common.ts';

const targets = z.array(Id).min(1).max(12);
const shortText = z.string().min(1).max(160);

/**
 * SceneAction allowlist. Lessons and the tutor can only change the scene through these.
 * Never allowed: scripts, shell commands, file paths, shaders, or free-form object creation.
 */
export const SceneAction = z.discriminatedUnion('type', [
  z.object({ type: z.literal('focus'), target_id: Id }),
  z.object({ type: z.literal('isolate'), target_ids: targets }),
  z.object({ type: z.literal('explode'), factor: z.number().min(0).max(1) }),
  z.object({ type: z.literal('collapse') }),
  z.object({ type: z.literal('highlight'), target_ids: targets }),
  z.object({ type: z.literal('highlight_path'), path_id: Id }),
  z.object({ type: z.literal('animate_flow'), path_id: Id }),
  z.object({ type: z.literal('clear_highlight') }),
  z.object({ type: z.literal('show_evidence'), evidence_id: Id }),
  z.object({ type: z.literal('show_annotation'), target_id: Id, text: shortText }),
  z.object({ type: z.literal('ask_prediction'), question: shortText }),
  z.object({ type: z.literal('reset_experiment') }),
]);
export type SceneAction = z.infer<typeof SceneAction>;
export type SceneActionType = SceneAction['type'];

/**
 * The tutor may only *show*. It cannot break or repair edges, and it cannot pass,
 * fail, or advance a lesson (only the deterministic lesson engine does that).
 */
export const TUTOR_ACTION_TYPES = [
  'focus',
  'isolate',
  'explode',
  'collapse',
  'highlight',
  'highlight_path',
  'animate_flow',
  'clear_highlight',
  'show_evidence',
  'show_annotation',
  'ask_prediction',
] as const satisfies readonly SceneActionType[];

export const MAX_TUTOR_ACTIONS = 4;
