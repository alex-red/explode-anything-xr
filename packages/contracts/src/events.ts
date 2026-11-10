import { z } from 'zod';
import { Id } from './common.ts';
import { SceneAction } from './actions.ts';

/**
 * Everything that changes SceneState is an event. The engine is a pure function of the
 * event log, so replay is deterministic and undo = drop the last undoable event and replay.
 */
export const EngineEvent = z.discriminatedUnion('type', [
  z.object({ type: z.literal('set_explode'), factor: z.number().min(0).max(1) }),
  z.object({ type: z.literal('select'), target_id: Id.nullable() }),
  z.object({ type: z.literal('trace'), path_id: Id }),
  z.object({ type: z.literal('unplug'), edge_id: Id }),
  /** Repair attempt: plug the detached edge into a candidate socket (a target node id). */
  z.object({ type: z.literal('plug'), edge_id: Id, target_id: Id }),
  z.object({ type: z.literal('predict'), target_id: Id }),
  z.object({ type: z.literal('open_evidence'), evidence_id: Id.nullable() }),
  z.object({ type: z.literal('next') }),
  z.object({ type: z.literal('skip_lesson') }),
  z.object({ type: z.literal('reset') }),
  z.object({
    type: z.literal('apply_action'),
    origin: z.enum(['lesson', 'tutor']),
    action: SceneAction,
  }),
]);
export type EngineEvent = z.infer<typeof EngineEvent>;
export type EngineEventType = EngineEvent['type'];

/** Events the user can undo (presentation-only and lesson bookkeeping events are not undoable). */
export const UNDOABLE_EVENTS: ReadonlySet<EngineEventType> = new Set([
  'set_explode',
  'select',
  'trace',
  'unplug',
  'plug',
]);
