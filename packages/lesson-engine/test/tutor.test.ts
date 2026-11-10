import { describe, expect, it } from 'vitest';
import { createContext, initialState, reduce, scriptedTutorTurn, validateTutorPlan } from '../src/index.ts';
import { miniBundle } from './fixture.ts';

const ctx = createContext(miniBundle());
const BREAK = 'edge:fn:auth->fn:verify';
const okPlan = {
  say: 'The handler calls the auth service.',
  claim_status: 'static_verified',
  evidence_ids: ['ev:src:fn:login'],
  actions: [{ type: 'highlight', target_ids: ['fn:login', 'fn:auth'] }],
  abstain: false,
};

describe('validateTutorPlan', () => {
  it('accepts a grounded plan', () => {
    expect(validateTutorPlan(ctx, okPlan).ok).toBe(true);
  });

  const reject = (name: string, plan: unknown) =>
    it(`rejects ${name}`, () => {
      const r = validateTutorPlan(ctx, plan);
      expect(r.ok).toBe(false);
    });

  reject('an unknown node id', { ...okPlan, actions: [{ type: 'focus', target_id: 'fn:invented' }] });
  reject('an unknown evidence id', { ...okPlan, evidence_ids: ['ev:made-up'] });
  reject('a non-allowlisted action (tutor cannot reset experiments)', { ...okPlan, actions: [{ type: 'reset_experiment' }] });
  reject('an action type outside the schema', { ...okPlan, actions: [{ type: 'run_shell', cmd: 'rm -rf /' }] });
  reject('more than four actions', { ...okPlan, actions: Array(5).fill({ type: 'clear_highlight' }) });
  reject('a promoted claim (observed without observed evidence)', { ...okPlan, claim_status: 'observed' });
  reject('a claim with no evidence that is stronger than inferred', { ...okPlan, evidence_ids: [] });
  reject('garbage', 'hello');
  reject('an oversized utterance', { ...okPlan, say: 'x'.repeat(401) });

  it('accepts observed claims backed by a mutation run', () => {
    expect(validateTutorPlan(ctx, { ...okPlan, claim_status: 'observed', evidence_ids: ['ev:mut:verify'] }).ok).toBe(true);
  });
});

describe('scriptedTutorTurn', () => {
  it('always produces plans that pass validation', () => {
    let s = initialState(ctx);
    const triggers = ['explain_selection', 'what_depends', 'why_failed', 'hint', 'free_text'] as const;
    const check = () => {
      for (const trigger of triggers) {
        const plan = scriptedTutorTurn(ctx, s, { trigger, selected_id: s.selected_id });
        expect(validateTutorPlan(ctx, plan)).toMatchObject({ ok: true });
      }
    };
    check();
    s = reduce(ctx, s, { type: 'select', target_id: 'fn:auth' });
    check();
    s = reduce(ctx, s, { type: 'unplug', edge_id: BREAK });
    check();
  });

  it('labels a recorded failure as observed and an unrecorded one as a hypothesis', () => {
    const s = reduce(ctx, initialState(ctx), { type: 'unplug', edge_id: BREAK });
    expect(scriptedTutorTurn(ctx, s, { trigger: 'why_failed', selected_id: null }).claim_status).toBe('observed');
    const noMut = createContext(miniBundle(false));
    const s2 = reduce(noMut, initialState(noMut), { type: 'unplug', edge_id: BREAK });
    const plan = scriptedTutorTurn(noMut, s2, { trigger: 'why_failed', selected_id: null });
    expect(plan.claim_status).toBe('inferred');
    expect(plan.say).toMatch(/hypothesis/i);
  });

  it('abstains instead of guessing', () => {
    expect(scriptedTutorTurn(ctx, initialState(ctx), { trigger: 'explain_selection', selected_id: null }).abstain).toBe(true);
  });
});
