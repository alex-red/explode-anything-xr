import type { GraphNode, SceneState } from '@explode/contracts';
import type { EngineContext } from './context.ts';

/**
 * Detail levels for exploring a software graph (docs/EXPLORE_PLAN.md W11). A presentation
 * choice only: it is not in the event log, and it never decides what is true.
 *
 * - `key`: the subsystems, the routes, and every part on a named flow path.
 * - `supporting`: also modules, classes and the most connected functions.
 * - `all`: everything.
 */
export const DETAIL_LEVELS = ['key', 'supporting', 'all'] as const;
export type DetailLevel = (typeof DETAIL_LEVELS)[number];
export type DetailTier = 'key' | 'supporting' | 'extra';

/** Importance at or above which a part is key, or supporting (the indexer's scale). */
export const KEY_IMPORTANCE = 0.6;
export const SUPPORTING_IMPORTANCE = 0.45;

export function detailTier(node: Pick<GraphNode, 'kind' | 'importance'>): DetailTier {
  if (node.kind === 'cluster' || node.kind === 'system' || node.importance >= KEY_IMPORTANCE) return 'key';
  return node.importance >= SUPPORTING_IMPORTANCE ? 'supporting' : 'extra';
}

/** Whether a tier shows at a level, before anything is pinned. */
export function tierShown(tier: DetailTier, level: DetailLevel): boolean {
  return level === 'all' || tier === 'key' || (level === 'supporting' && tier === 'supporting');
}

/** One level more (`+1`) or fewer (`-1`), stopping at either end. */
export function stepDetail(level: DetailLevel, by: 1 | -1): DetailLevel {
  const i = DETAIL_LEVELS.indexOf(level) + by;
  return DETAIL_LEVELS[Math.max(0, Math.min(DETAIL_LEVELS.length - 1, i))]!;
}

/**
 * Parts that stay visible at every level because the learner needs them now: the selected and
 * focused parts, highlighted parts, the traced path, parts a cut stops, an isolated set, the
 * annotation's target, both ends of a cut connection, and every socket a repair offers.
 *
 * While the consequence of a cut must stay hidden (`revealConsequences` false: a prediction, or an
 * incident drill before its diagnosis), neither the parts it stops nor the cut's far end are
 * pinned, so a hidden part popping into view never gives the answer away.
 */
export function pinnedIds(ctx: EngineContext, s: SceneState, revealConsequences = true): Set<string> {
  const out = new Set<string>();
  const add = (id: string | null | undefined) => {
    if (id) out.add(id);
  };
  add(s.selected_id);
  add(s.focus_id);
  add(s.annotation?.target_id);
  add(s.prediction?.target_id);
  for (const id of s.highlighted_ids) add(id);
  for (const id of s.isolated_ids ?? []) add(id);
  if (revealConsequences) for (const c of s.consequences) for (const id of c.affected_ids) add(id);
  const path = s.active_path_id ? ctx.paths.get(s.active_path_id) : undefined;
  for (const id of path?.node_ids ?? []) add(id);
  const lesson = s.lesson ? ctx.lessons.get(s.lesson.lesson_id) : undefined;
  for (const edgeId of s.broken_edge_ids) {
    const e = ctx.edges.get(edgeId);
    add(e?.source_id);
    if (revealConsequences) add(e?.target_id);
    if (lesson?.break_edge_id === edgeId) for (const id of lesson.repair_candidates) add(id);
  }
  return out;
}

/** Ids visible at `level` in state `s`: their tier is shown, or they are pinned. */
export function visibleAtDetail(ctx: EngineContext, s: SceneState, level: DetailLevel, revealConsequences = true): Set<string> {
  const pinned = pinnedIds(ctx, s, revealConsequences);
  const out = new Set<string>();
  for (const n of ctx.nodes.values()) if (tierShown(detailTier(n), level) || pinned.has(n.id)) out.add(n.id);
  return out;
}
