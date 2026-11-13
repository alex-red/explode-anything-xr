import { z } from 'zod';
import { Id } from './common.ts';

/**
 * What the assistant may do on the learner's behalf when the learner asks in their own words
 * (a `free_text` turn). Each one is the same thing a hand or a button does: the app runs it
 * through the same handlers, and the lesson engine still decides what it means for the lesson.
 * Never allowed: scripts, shell commands, file paths, or anything a hand could not do.
 */
export const AssistantCommand = z.discriminatedUnion('type', [
  /** Press a toolbar, settings or dock button by its id, exactly as a ray press would. */
  z.object({ type: z.literal('press'), button_id: Id }),
  z.object({ type: z.literal('select'), target_id: Id }),
  z.object({ type: z.literal('deselect') }),
  z.object({ type: z.literal('set_explode'), factor: z.number().min(0).max(1) }),
  z.object({ type: z.literal('trace'), path_id: Id }),
  z.object({ type: z.literal('unplug'), edge_id: Id }),
  /** Plug a disconnected connection into a part. */
  z.object({ type: z.literal('plug'), edge_id: Id, target_id: Id }),
  /** Answer a prediction question with a part. */
  z.object({ type: z.literal('predict'), target_id: Id }),
  z.object({ type: z.literal('open_evidence'), evidence_id: Id }),
  z.object({ type: z.literal('close_evidence') }),
  z.object({ type: z.literal('set_detail'), level: z.enum(['key', 'supporting', 'all']) }),
  /** Open another of the systems the app ships. */
  z.object({ type: z.literal('open_system'), system_id: Id }),
]);
export type AssistantCommand = z.infer<typeof AssistantCommand>;
export type AssistantCommandType = AssistantCommand['type'];

export const MAX_ASSISTANT_COMMANDS = 4;

/**
 * What the learner has in front of them when they ask. Presentation state only: it tells the
 * model what "this" and "that button" mean, and is never evidence for a claim.
 */
export const ViewContext = z.object({
  explode_factor: z.number().min(0).max(1),
  detail: z.enum(['key', 'supporting', 'all']),
  in_session: z.boolean(),
  active_path_id: Id.nullable(),
  evidence_open_id: Id.nullable(),
  highlighted_ids: z.array(Id).max(12),
  /** Parts drawn at the current detail level (capped; the graph data lists every part). */
  visible_node_ids: z.array(Id).max(40),
  /** True while a prediction question is open and its answer is still hidden. */
  awaiting_prediction: z.boolean(),
  /** Every button the learner can see, with the label it shows now. */
  buttons: z.array(z.object({ id: Id, label: z.string().max(40), enabled: z.boolean() })).max(48),
  systems: z.array(z.object({ id: Id, name: z.string().max(80), current: z.boolean() })).max(8),
});
export type ViewContext = z.infer<typeof ViewContext>;

/** One earlier line of the conversation, so a follow-up ("and that one?") makes sense. */
export const ConversationTurn = z.object({
  role: z.enum(['learner', 'assistant']),
  text: z.string().min(1).max(400),
});
export type ConversationTurn = z.infer<typeof ConversationTurn>;

export const MAX_HISTORY_TURNS = 6;
