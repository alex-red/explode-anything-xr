import type { EngineEvent, Expectation, Lesson, SceneAction, SceneState } from '@explode/contracts';
import { UNDOABLE_EVENTS } from '@explode/contracts';
import type { EngineContext } from './context.ts';
import { computeConsequence } from './propagation.ts';

export function initialState(ctx: EngineContext, lessonId: string | null = firstLessonId(ctx)): SceneState {
  const base: SceneState = {
    system_id: ctx.bundle.graph.system_id,
    revision: ctx.bundle.graph.revision.value,
    explode_factor: 0,
    selected_id: null,
    focus_id: null,
    isolated_ids: null,
    highlighted_ids: [],
    active_path_id: null,
    flow_animating: false,
    broken_edge_ids: [],
    consequences: [],
    prediction: null,
    evidence_open_id: null,
    annotation: null,
    question: null,
    feedback: null,
    misplug_count: 0,
    misconceptions: [],
    lesson: lessonId && ctx.lessons.has(lessonId) ? { lesson_id: lessonId, step_index: 0, status: 'active' } : null,
  };
  return enterStep(ctx, base);
}

function firstLessonId(ctx: EngineContext): string | null {
  return ctx.bundle.lessons[0]?.id ?? null;
}

export function currentLesson(ctx: EngineContext, state: SceneState): Lesson | null {
  return state.lesson ? (ctx.lessons.get(state.lesson.lesson_id) ?? null) : null;
}

export function currentStep(ctx: EngineContext, state: SceneState) {
  const lesson = currentLesson(ctx, state);
  if (!lesson || !state.lesson || state.lesson.status !== 'active') return null;
  return lesson.steps[state.lesson.step_index] ?? null;
}

/** Pure reducer: (state, event) → state. Never mutates its inputs. */
export function reduce(ctx: EngineContext, state: SceneState, event: EngineEvent): SceneState {
  const next = applyEvent(ctx, state, event);
  return advanceLesson(ctx, state, next, event);
}

export function replay(ctx: EngineContext, events: readonly EngineEvent[], lessonId?: string | null): SceneState {
  let state = initialState(ctx, lessonId === undefined ? firstLessonId(ctx) : lessonId);
  for (const e of events) state = reduce(ctx, state, e);
  return state;
}

/** Undo = drop the most recent undoable event; the caller replays the remaining log. */
export function undo(events: readonly EngineEvent[]): EngineEvent[] {
  for (let i = events.length - 1; i >= 0; i--) {
    if (UNDOABLE_EVENTS.has(events[i]!.type)) return [...events.slice(0, i), ...events.slice(i + 1)];
  }
  return [...events];
}

function applyEvent(ctx: EngineContext, s: SceneState, e: EngineEvent): SceneState {
  switch (e.type) {
    case 'set_explode':
      return { ...s, explode_factor: clamp01(e.factor) };
    case 'select':
      if (e.target_id !== null && !ctx.nodes.has(e.target_id)) return s;
      return { ...s, selected_id: e.target_id, focus_id: e.target_id ?? s.focus_id };
    case 'trace': {
      const path = ctx.paths.get(e.path_id);
      if (!path) return s;
      return { ...s, active_path_id: path.id, highlighted_ids: [...path.node_ids], flow_animating: true, feedback: null };
    }
    case 'unplug': {
      const edge = ctx.edges.get(e.edge_id);
      if (!edge || !edge.is_mutable_in_sandbox || s.broken_edge_ids.includes(edge.id)) return s;
      const consequence = computeConsequence(ctx, edge.id);
      return {
        ...s,
        broken_edge_ids: [...s.broken_edge_ids, edge.id],
        consequences: [...s.consequences.filter((c) => c.edge_id !== edge.id), consequence],
        feedback: null,
      };
    }
    case 'plug': {
      const edge = ctx.edges.get(e.edge_id);
      if (!edge || !s.broken_edge_ids.includes(edge.id)) return s;
      if (e.target_id !== edge.target_id) {
        const target = ctx.nodes.get(e.target_id);
        const expected = ctx.nodes.get(edge.target_id);
        return {
          ...s,
          misplug_count: s.misplug_count + 1,
          feedback: `${target?.label ?? 'That socket'} doesn't accept this connection. Follow the path: what does ${ctx.nodes.get(edge.source_id)?.label ?? 'the source'} need to reach?${expected && s.misplug_count >= 1 ? ` (Hint: ${expected.label}.)` : ''}`,
        };
      }
      return {
        ...s,
        broken_edge_ids: s.broken_edge_ids.filter((id) => id !== edge.id),
        consequences: s.consequences.filter((c) => c.edge_id !== edge.id),
        feedback: 'Reconnected. The flow is restored.',
      };
    }
    case 'predict': {
      if (!ctx.nodes.has(e.target_id)) return s;
      const lesson = currentLesson(ctx, s);
      const edgeId = lesson?.break_edge_id ?? s.broken_edge_ids[0];
      if (!edgeId) return { ...s, prediction: { target_id: e.target_id, correct: false } };
      const affected = computeConsequence(ctx, edgeId).affected_ids;
      const correct = affected.includes(e.target_id);
      const tag = lesson?.misconception_on_wrong_prediction;
      return {
        ...s,
        prediction: { target_id: e.target_id, correct },
        misconceptions: !correct && tag && !s.misconceptions.includes(tag) ? [...s.misconceptions, tag] : s.misconceptions,
      };
    }
    case 'open_evidence':
      if (e.evidence_id !== null && !ctx.evidence.has(e.evidence_id)) return s;
      return { ...s, evidence_open_id: e.evidence_id };
    case 'next':
    case 'skip_lesson':
      return s; // handled by advanceLesson
    case 'reset':
      return initialState(ctx, s.lesson?.lesson_id ?? null);
    case 'apply_action':
      return applyAction(ctx, s, e.action);
  }
}

export function applyAction(ctx: EngineContext, s: SceneState, a: SceneAction): SceneState {
  const known = (ids: readonly string[]) => ids.filter((id) => ctx.nodes.has(id));
  switch (a.type) {
    case 'focus':
      return ctx.nodes.has(a.target_id) ? { ...s, focus_id: a.target_id } : s;
    case 'isolate': {
      const ids = known(a.target_ids);
      return ids.length ? { ...s, isolated_ids: ids } : s;
    }
    case 'explode':
      return { ...s, explode_factor: clamp01(a.factor) };
    case 'collapse':
      return { ...s, explode_factor: 0, isolated_ids: null };
    case 'highlight':
      return { ...s, highlighted_ids: known(a.target_ids) };
    case 'highlight_path': {
      const p = ctx.paths.get(a.path_id);
      return p ? { ...s, active_path_id: p.id, highlighted_ids: [...p.node_ids] } : s;
    }
    case 'animate_flow': {
      const p = ctx.paths.get(a.path_id);
      return p ? { ...s, active_path_id: p.id, highlighted_ids: [...p.node_ids], flow_animating: true } : s;
    }
    case 'clear_highlight':
      return { ...s, highlighted_ids: [], active_path_id: null, flow_animating: false, isolated_ids: null, annotation: null };
    case 'show_evidence':
      return ctx.evidence.has(a.evidence_id) ? { ...s, evidence_open_id: a.evidence_id } : s;
    case 'show_annotation':
      return ctx.nodes.has(a.target_id) ? { ...s, annotation: { target_id: a.target_id, text: a.text } } : s;
    case 'ask_prediction':
      return { ...s, question: a.question };
    case 'reset_experiment':
      return { ...s, broken_edge_ids: [], consequences: [], prediction: null, feedback: null };
  }
}

function satisfied(ctx: EngineContext, x: Expectation, before: SceneState, after: SceneState, e: EngineEvent): boolean {
  switch (x.type) {
    case 'next':
      return e.type === 'next';
    case 'explode_at_least':
      return after.explode_factor >= x.factor;
    case 'collapse_below':
      return after.explode_factor <= x.factor;
    case 'select':
      return after.selected_id === x.target_id;
    case 'trace':
      return e.type === 'trace' && after.active_path_id === x.path_id;
    case 'unplug':
      return after.broken_edge_ids.includes(x.edge_id);
    case 'predict':
      return e.type === 'predict' && after.prediction !== null;
    case 'repair':
      return before.broken_edge_ids.includes(x.edge_id) && !after.broken_edge_ids.includes(x.edge_id);
    case 'open_evidence':
      return after.evidence_open_id !== null && e.type === 'open_evidence';
  }
}

function advanceLesson(ctx: EngineContext, before: SceneState, after: SceneState, e: EngineEvent): SceneState {
  if (!after.lesson || after.lesson.status !== 'active') return after;
  const lesson = currentLesson(ctx, after);
  if (!lesson) return after;
  if (e.type === 'skip_lesson') return { ...after, lesson: { ...after.lesson, status: 'skipped' }, question: null };
  if (e.type === 'reset') return after;

  const step = lesson.steps[after.lesson.step_index];
  if (!step || !satisfied(ctx, step.expect, before, after, e)) return after;

  let s = after;
  if (step.expect.type === 'predict' && step.feedback && s.prediction) {
    s = { ...s, feedback: s.prediction.correct ? step.feedback.correct : step.feedback.incorrect };
  }
  return completeStepsFrom(ctx, lesson, s, after.lesson.step_index + 1);
}

/**
 * Enter step `index`. Steps whose expectation the state already meets (the learner did it
 * early, e.g. exploded during the intro or unplugged before being asked) complete on entry,
 * so a lesson can never dead-end on an action that would now be a no-op.
 */
function completeStepsFrom(ctx: EngineContext, lesson: Lesson, s: SceneState, index: number): SceneState {
  let out = s;
  for (let i = index; ; i++) {
    if (i >= lesson.steps.length) return { ...out, lesson: { ...out.lesson!, status: 'complete' }, question: null };
    out = enterStep(ctx, { ...out, lesson: { ...out.lesson!, step_index: i }, question: null });
    if (!alreadySatisfied(lesson.steps[i]!.expect, out)) return out;
  }
}

function alreadySatisfied(x: Expectation, s: SceneState): boolean {
  switch (x.type) {
    case 'explode_at_least':
      return s.explode_factor >= x.factor;
    case 'unplug':
      return s.broken_edge_ids.includes(x.edge_id);
    default:
      return false;
  }
}

function enterStep(ctx: EngineContext, s: SceneState): SceneState {
  const step = currentStep(ctx, s);
  if (!step) return s;
  let out = s;
  for (const action of step.on_enter) out = applyAction(ctx, out, action);
  return out;
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}
