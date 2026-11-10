import type { ContentBundle, EngineEvent } from '@explode/contracts';
import { hashTree } from '@explode/indexer';
import { computeConsequence, createContext, reduce, replay } from '@explode/lesson-engine';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildDrivetrainBundle } from '../src/drivetrain.ts';
import { layoutProblems, verifyBundle } from '../src/index.ts';
import { DRIVETRAIN_BUNDLE_PATH, REPO_BUNDLE_PATH, REPO_DEMO_DIR } from '../src/paths.ts';

const load = (p: string) => JSON.parse(readFileSync(p, 'utf8')) as ContentBundle;
const repo = load(REPO_BUNDLE_PATH);
const drivetrain = load(DRIVETRAIN_BUNDLE_PATH);
const MAIN_EDGE = 'edge:calls:fn:src/auth/service.ts#authservice.login->fn:src/sessions/store.ts#sessionstore.create';
const CREATE = 'fn:src/sessions/store.ts#sessionstore.create';
const DT_EDGE = 'edge:powers:part:inverter->part:motor';

describe('generated bundles', () => {
  it('pass schema, integrity, layout and hash checks', () => {
    expect(verifyBundle(repo)).toEqual([]);
    expect(verifyBundle(drivetrain)).toEqual([]);
    expect(layoutProblems(repo.layout)).toEqual([]);
  });

  it('are up to date with their sources', () => {
    expect(repo.graph.revision.value).toBe(hashTree(resolve(REPO_DEMO_DIR, 'fixture')));
    expect(buildDrivetrainBundle(drivetrain).content_hash).toBe(drivetrain.content_hash);
  });

  it('marks only mutated edges as sandbox-mutable and never marks an edge observed', () => {
    const mutable = repo.graph.edges.filter((e) => e.is_mutable_in_sandbox).map((e) => e.id);
    const mutated = repo.evidence.flatMap((e) => (e.kind === 'mutation_run' ? [e.mutation.edge_id] : []));
    expect(mutable.sort()).toEqual(mutated.sort());
    expect(repo.graph.edges.some((e) => e.truth_status === 'observed')).toBe(false);
  });

  it('marks executed functions observed with the recorded baseline run', () => {
    const login = repo.graph.nodes.find((n) => n.id === 'fn:src/auth/service.ts#authservice.login')!;
    expect(login.truth_status).toBe('observed');
    expect(login.evidence_ids).toContain('ev:run:baseline');
  });
});

describe('repo consequences', () => {
  const ctx = createContext(repo);

  it('the main break is observed, backed by a failing mutation run', () => {
    const c = computeConsequence(ctx, MAIN_EDGE);
    expect(c.truth_status).toBe('observed');
    expect(c.first_affected_id).toBe(CREATE);
    expect(c.affected_ids).toEqual([CREATE, 'fn:src/auth/tokens.ts#signtoken']);
    const ev = repo.evidence.find((e) => e.id === c.evidence_ids[0]);
    expect(ev?.kind).toBe('mutation_run');
    if (ev?.kind === 'mutation_run') expect(ev.run.failed).toBeGreaterThan(0);
  });

  it('an edge without a recorded mutation is only a hypothesis', () => {
    const edge = repo.graph.edges.find((e) => e.relation === 'calls' && !e.is_mutable_in_sandbox)!;
    expect(computeConsequence(ctx, edge.id).truth_status).toBe('inferred');
  });
});

describe('lessons replay to completion', () => {
  it('drivetrain tutorial', () => {
    const ctx = createContext(drivetrain);
    const events: EngineEvent[] = [
      { type: 'set_explode', factor: 1 },
      { type: 'trace', path_id: 'path:power' },
      { type: 'unplug', edge_id: DT_EDGE },
      { type: 'predict', target_id: 'part:motor' },
      { type: 'next' },
      { type: 'plug', edge_id: DT_EDGE, target_id: 'part:motor' },
      { type: 'set_explode', factor: 0 },
    ];
    const s = replay(ctx, events);
    expect(s.lesson?.status).toBe('complete');
    expect(s.prediction?.correct).toBe(true);
    expect(s.broken_edge_ids).toEqual([]);
  });

  it('drivetrain consequence is the teaching model, and a wrong socket does not repair', () => {
    const ctx = createContext(drivetrain);
    let s = replay(ctx, [
      { type: 'set_explode', factor: 1 },
      { type: 'trace', path_id: 'path:power' },
      { type: 'unplug', edge_id: DT_EDGE },
    ]);
    expect(s.consequences[0]?.truth_status).toBe('authored_model');
    expect(s.consequences[0]?.affected_ids).toContain('part:wheel-left');
    s = reduce(ctx, s, { type: 'plug', edge_id: DT_EDGE, target_id: 'part:gearbox' });
    expect(s.broken_edge_ids).toEqual([DT_EDGE]);
    expect(s.misplug_count).toBe(1);
  });

  it('repo hero lesson', () => {
    const ctx = createContext(repo);
    const events: EngineEvent[] = [
      { type: 'next' },
      { type: 'set_explode', factor: 1 },
      { type: 'trace', path_id: 'path:login-request' },
      { type: 'open_evidence', evidence_id: 'ev:src:route:post:/login' },
      { type: 'predict', target_id: CREATE },
      { type: 'unplug', edge_id: MAIN_EDGE },
      { type: 'next' },
      { type: 'plug', edge_id: MAIN_EDGE, target_id: CREATE },
      { type: 'next' },
    ];
    const s = replay(ctx, events);
    expect(s.lesson).toMatchObject({ lesson_id: 'lesson:repo-login', status: 'complete' });
    expect(s.prediction?.correct).toBe(true);
    expect(s.misconceptions).toEqual([]);
  });

  it('a prediction before the break is wrong and tags the misconception', () => {
    const ctx = createContext(repo);
    const s = replay(ctx, [
      { type: 'next' },
      { type: 'set_explode', factor: 1 },
      { type: 'trace', path_id: 'path:login-request' },
      { type: 'open_evidence', evidence_id: 'ev:src:route:post:/login' },
      { type: 'predict', target_id: 'fn:src/users/repository.ts#userrepository.findbyemail' },
    ]);
    expect(s.prediction?.correct).toBe(false);
    expect(s.misconceptions).toEqual(['assumes-failure-is-local']);
  });
});
