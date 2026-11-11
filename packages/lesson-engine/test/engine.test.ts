import { describe, expect, it } from 'vitest';
import type { EngineEvent } from '@explode/contracts';
import { ContentBundle, checkBundleIntegrity } from '@explode/contracts';
import { computeConsequence, createContext, initialState, reduce, replay, undo } from '../src/index.ts';
import { miniBundle } from './fixture.ts';

const ctx = createContext(miniBundle());
const BREAK = 'edge:fn:auth->fn:verify';

const fullRun: EngineEvent[] = [
  { type: 'next' },
  { type: 'set_explode', factor: 1 },
  { type: 'trace', path_id: 'path:login' },
  { type: 'predict', target_id: 'fn:session' },
  { type: 'unplug', edge_id: BREAK },
  { type: 'plug', edge_id: BREAK, target_id: 'fn:verify' },
];

describe('fixture', () => {
  it('is a valid, consistent bundle', () => {
    expect(ContentBundle.safeParse(miniBundle()).success).toBe(true);
    expect(checkBundleIntegrity(miniBundle())).toEqual([]);
  });
});

describe('propagation', () => {
  it('marks downstream path nodes as affected, in order', () => {
    const c = computeConsequence(ctx, BREAK);
    expect(c.affected_ids).toEqual(['fn:verify', 'fn:session']);
    expect(c.first_affected_id).toBe('fn:verify');
  });
  it('is observed only with a recorded mutation run', () => {
    expect(computeConsequence(ctx, BREAK).truth_status).toBe('observed');
    expect(computeConsequence(ctx, BREAK).evidence_ids).toEqual(['ev:mut:verify']);
    const noMut = createContext(miniBundle(false));
    expect(computeConsequence(noMut, BREAK).truth_status).toBe('inferred');
  });
});

describe('reducer', () => {
  it('starts on the first lesson step', () => {
    const s = initialState(ctx);
    expect(s.lesson).toEqual({ lesson_id: 'lesson:mini', step_index: 0, status: 'active' });
    expect(s.explode_factor).toBe(0);
  });

  it('completes the lesson through the full trace/break/repair loop', () => {
    const s = replay(ctx, fullRun);
    expect(s.lesson?.status).toBe('complete');
    expect(s.broken_edge_ids).toEqual([]);
    expect(s.prediction).toEqual({ target_id: 'fn:session', correct: true });
  });

  it('drops a step\'s annotation when the lesson completes', () => {
    const bundle = miniBundle();
    const breakStep = bundle.lessons[0]!.steps.find((st) => st.id === 'step:break')!;
    breakStep.on_enter = [{ type: 'show_annotation', target_id: 'fn:auth', text: 'This link carries the login.' }];
    const annotated = createContext(bundle);
    const midway = replay(annotated, fullRun.slice(0, 5));
    expect(midway.annotation?.text).toBe('This link carries the login.'); // still shown while the lesson runs
    const done = replay(annotated, fullRun);
    expect(done.lesson?.status).toBe('complete');
    expect(done.annotation).toBeNull();
  });

  it('does not advance on the wrong action', () => {
    let s = initialState(ctx);
    s = reduce(ctx, s, { type: 'set_explode', factor: 1 }); // step 0 expects Next
    expect(s.lesson?.step_index).toBe(0);
  });

  it('only unplugs sandbox-mutable edges', () => {
    const s = reduce(ctx, initialState(ctx), { type: 'unplug', edge_id: 'edge:fn:router->fn:login' });
    expect(s.broken_edge_ids).toEqual([]);
  });

  it('rejects a wrong socket and counts the attempt', () => {
    let s = replay(ctx, fullRun.slice(0, 5));
    expect(s.broken_edge_ids).toEqual([BREAK]);
    s = reduce(ctx, s, { type: 'plug', edge_id: BREAK, target_id: 'fn:router' });
    expect(s.broken_edge_ids).toEqual([BREAK]);
    expect(s.misplug_count).toBe(1);
    expect(s.lesson?.status).toBe('active');
  });

  it('records a misconception on a wrong prediction', () => {
    const s = replay(ctx, [...fullRun.slice(0, 3), { type: 'predict', target_id: 'fn:router' }]);
    expect(s.prediction?.correct).toBe(false);
    expect(s.misconceptions).toEqual(['assumes-failure-is-local']);
    expect(s.feedback).toBe('Not quite');
  });

  it('ignores events that reference unknown ids', () => {
    const s0 = initialState(ctx);
    expect(reduce(ctx, s0, { type: 'select', target_id: 'fn:nope' })).toBe(s0);
    expect(reduce(ctx, s0, { type: 'trace', path_id: 'path:nope' })).toBe(s0);
  });

  it('is deterministic under replay and stable across many cycles', () => {
    const cycles: EngineEvent[] = [];
    for (let i = 0; i < 20; i++) {
      cycles.push({ type: 'set_explode', factor: 1 }, { type: 'set_explode', factor: 0 });
      cycles.push({ type: 'unplug', edge_id: BREAK }, { type: 'plug', edge_id: BREAK, target_id: 'fn:verify' });
    }
    const a = replay(ctx, cycles, null);
    const b = replay(ctx, cycles, null);
    expect(a).toEqual(b);
    expect(a.broken_edge_ids).toEqual([]);
    expect(a.explode_factor).toBe(0);
  });

  it('reset returns to the initial state', () => {
    const s = replay(ctx, [...fullRun.slice(0, 5), { type: 'reset' }]);
    expect(s).toEqual(initialState(ctx));
  });
});

describe('undo', () => {
  it('drops the most recent undoable event only', () => {
    const log: EngineEvent[] = [{ type: 'next' }, { type: 'set_explode', factor: 1 }, { type: 'next' }];
    expect(undo(log)).toEqual([{ type: 'next' }, { type: 'next' }]);
    expect(undo([{ type: 'next' }])).toEqual([{ type: 'next' }]);
  });
  it('undoing an unplug restores the edge after replay', () => {
    const log = fullRun.slice(0, 5);
    expect(replay(ctx, undo(log)).broken_edge_ids).toEqual([]);
  });
});

describe('lesson robustness', () => {
  it('completes steps the learner already did early instead of dead-ending', () => {
    // Explode during the intro, and unplug before the lesson asks for it.
    const s = replay(ctx, [
      { type: 'set_explode', factor: 1 },
      { type: 'next' }, // intro → explode step is already satisfied → trace
      { type: 'trace', path_id: 'path:login' },
      { type: 'unplug', edge_id: BREAK }, // early, during the predict step
      { type: 'predict', target_id: 'fn:session' }, // → break step already satisfied → repair
      { type: 'plug', edge_id: BREAK, target_id: 'fn:verify' },
    ]);
    expect(s.lesson?.status).toBe('complete');
  });
});
