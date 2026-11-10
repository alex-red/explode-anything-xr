import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ContentBundle, type EngineEvent } from '@explode/contracts';
import { validateTutorPlan } from '@explode/lesson-engine';
import drivetrainJson from '../src/content/drivetrain.bundle.json';
import repoJson from '../src/content/repo-demo.bundle.json';
import { Store } from '../src/app/store.ts';
import { TutorClient } from '../src/app/tutor-client.ts';

const drivetrain = ContentBundle.parse(drivetrainJson);
const repo = ContentBundle.parse(repoJson);
const bundles = new Map([drivetrain, repo].map((b) => [b.graph.system_id, b]));

class MemoryStorage {
  private m = new Map<string, string>();
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  clear() {
    this.m.clear();
  }
}

beforeEach(() => {
  vi.stubGlobal('localStorage', new MemoryStorage());
});

const BREAK_DT = 'edge:powers:part:inverter->part:motor';
const tutorialRun: EngineEvent[] = [
  { type: 'set_explode', factor: 1 },
  { type: 'trace', path_id: 'path:power' },
  { type: 'unplug', edge_id: BREAK_DT },
  { type: 'predict', target_id: 'part:motor' },
  { type: 'next' },
  { type: 'plug', edge_id: BREAK_DT, target_id: 'part:battery' }, // wrong socket first
  { type: 'plug', edge_id: BREAK_DT, target_id: 'part:motor' },
  { type: 'set_explode', factor: 0 },
];

describe('Store', () => {
  it('runs the drivetrain tutorial to completion through dispatch', () => {
    const store = new Store(bundles);
    store.load(drivetrain.graph.system_id);
    for (const e of tutorialRun) store.dispatch(e);
    expect(store.state.lesson?.status).toBe('complete');
    expect(store.state.misplug_count).toBe(1);
    expect(store.state.prediction?.correct).toBe(true);
  });

  it('does not log rejected events', () => {
    const store = new Store(bundles);
    store.load(drivetrain.graph.system_id);
    store.dispatch({ type: 'select', target_id: 'part:does-not-exist' });
    store.dispatch({ type: 'next' }); // first step expects explode, not next
    expect(store.log).toEqual([]);
  });

  it('restores the session after a reload (killed browser)', () => {
    const a = new Store(bundles);
    a.load(drivetrain.graph.system_id);
    for (const e of tutorialRun.slice(0, 3)) a.dispatch(e);
    const b = new Store(bundles);
    expect(Store.lastActiveSystem()).toBe(drivetrain.graph.system_id);
    b.load(drivetrain.graph.system_id);
    expect(b.state).toEqual(a.state);
    expect(b.state.broken_edge_ids).toEqual([BREAK_DT]);
  });

  it('keeps a separate log per system and restart clears only the current one', () => {
    const s = new Store(bundles);
    s.load(drivetrain.graph.system_id);
    s.dispatch({ type: 'set_explode', factor: 1 });
    s.load(repo.graph.system_id);
    s.dispatch({ type: 'next' });
    s.restart();
    expect(s.log).toEqual([]);
    s.load(drivetrain.graph.system_id);
    expect(s.state.explode_factor).toBe(1);
  });

  it('undo reverts the last undoable action', () => {
    const s = new Store(bundles);
    s.load(drivetrain.graph.system_id);
    for (const e of tutorialRun.slice(0, 3)) s.dispatch(e);
    s.undo();
    expect(s.state.broken_edge_ids).toEqual([]);
  });

  it('ignores a persisted log from different content', () => {
    localStorage.setItem(
      'explode:session:v1',
      JSON.stringify({ active_system: drivetrain.graph.system_id, logs: { [drivetrain.graph.system_id]: { content_hash: 'f'.repeat(64), lesson_id: null, events: [{ type: 'set_explode', factor: 1 }] } } }),
    );
    const s = new Store(bundles);
    s.load(drivetrain.graph.system_id);
    expect(s.log).toEqual([]);
    expect(s.state.lesson?.lesson_id).toBe(drivetrain.lessons[0]!.id);
  });

  it('survives storage that throws', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    });
    const s = new Store(bundles);
    s.load(repo.graph.system_id);
    s.dispatch({ type: 'next' });
    expect(s.log.length).toBe(1);
  });
});

describe('TutorClient', () => {
  const load = () => {
    const s = new Store(bundles);
    s.load(repo.graph.system_id);
    s.dispatch({ type: 'select', target_id: 'fn:src/auth/service.ts#authservice.login' });
    return s;
  };
  const livePlan = {
    say: 'AuthService.login verifies the password and then creates a session.',
    claim_status: 'static_verified',
    evidence_ids: [repo.graph.nodes.find((n) => n.id === 'fn:src/auth/service.ts#authservice.login')!.evidence_ids[0]],
    actions: [{ type: 'focus', target_id: 'fn:src/auth/service.ts#authservice.login' }],
    abstain: false,
  };
  const respond = (body: unknown, status = 200) =>
    vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));

  it('uses the scripted tutor when no proxy is configured', async () => {
    const s = load();
    const a = await new TutorClient(null).ask(s, 'explain_selection', true);
    expect(a.source).toBe('scripted');
    expect(validateTutorPlan(s.ctx, a.plan).ok).toBe(true);
  });

  it('accepts a valid live plan', async () => {
    vi.stubGlobal('fetch', respond({ plan: livePlan, source: 'live', model: 'm' }));
    const a = await new TutorClient('https://proxy.example').ask(load(), 'explain_selection', true);
    expect(a.source).toBe('live');
    expect(a.plan.say).toBe(livePlan.say);
  });

  it('re-validates on the client and falls back on an invented id', async () => {
    vi.stubGlobal('fetch', respond({ plan: { ...livePlan, actions: [{ type: 'focus', target_id: 'fn:invented' }] }, source: 'live' }));
    const a = await new TutorClient('https://proxy.example').ask(load(), 'explain_selection', true);
    expect(a.source).toBe('scripted');
    expect(a.note).toMatch(/validation/);
  });

  it('falls back on network errors and HTTP errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('offline'))));
    expect((await new TutorClient('https://proxy.example').ask(load(), 'hint', true)).source).toBe('scripted');
    vi.stubGlobal('fetch', respond({ error: 'x' }, 500));
    expect((await new TutorClient('https://proxy.example').ask(load(), 'hint', true)).source).toBe('scripted');
  });

  it('respects the Live AI toggle', async () => {
    const f = respond({ plan: livePlan, source: 'live' });
    vi.stubGlobal('fetch', f);
    const a = await new TutorClient('https://proxy.example').ask(load(), 'explain_selection', false);
    expect(a.source).toBe('scripted');
    expect(f).not.toHaveBeenCalled();
  });
});
