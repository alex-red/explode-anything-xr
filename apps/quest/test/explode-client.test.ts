import { ContentBundle, type ExplodeJob } from '@explode/contracts';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildFromCuration, buildSubjectBundle, indexAnyRepo } from '../../../tools/content/src/index.ts';
import { FIXTURE_ANSWER, FIXTURE_SOURCE, writeFixture } from '../../../tools/content/test/any-repo-fixture.ts';
import { DRAFT, META } from '../../../tools/content/test/subject-fixture.ts';
import sdkJson from '../src/content/iwsdk.bundle.json';
import { ExplodeClient, ExplodeError, checkedBundle, repoQueryIn } from '../src/app/explode-client.ts';
import { estimateText } from '../src/app/proposal-card.ts';
import { savedProject } from '../src/app/projects.ts';
import { MAX_SAVED, MemorySavedSystems } from '../src/app/saved-systems.ts';

const dir = mkdtempSync(join(tmpdir(), 'explode-client-test-'));
writeFixture(dir);
const out = buildFromCuration(indexAnyRepo(dir, FIXTURE_SOURCE), FIXTURE_SOURCE, JSON.stringify(FIXTURE_ANSWER), { provider: 'test', model: 'm', created_at: '2026-11-13T00:00:00.000Z' });
rmSync(dir, { recursive: true, force: true });
if (!out.ok) throw new Error(out.problems.join('\n'));
const built = out.result.bundle;

const job: ExplodeJob = { id: 'job-0001-0001', kind: 'repository', status: 'researching', stage: { id: 'research', fraction: null }, proposal: null, refusal: null, error: null, system_id: null, build_seconds: null };

function client(answer: (method: string, path: string, body: unknown) => { status?: number; body: unknown } | Error) {
  const calls: string[] = [];
  const fetchFn = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const path = String(input).replace('https://proxy.test', '');
    calls.push(`${init?.method ?? 'GET'} ${path}`);
    const a = answer(init?.method ?? 'GET', path, init?.body ? JSON.parse(String(init.body)) : undefined);
    if (a instanceof Error) throw a;
    return new Response(typeof a.body === 'string' ? a.body : JSON.stringify(a.body), { status: a.status ?? 200 });
  }) as typeof fetch;
  return { api: new ExplodeClient('https://proxy.test/', fetchFn), calls };
}

describe('the explode client', () => {
  it('says building is available only when the server says so', async () => {
    expect(await client(() => ({ body: { ok: true, explode: true } })).api.available()).toBe(true);
    expect(await client(() => ({ body: { ok: true, explode: false } })).api.available()).toBe(false);
    expect(await client(() => ({ body: { ok: true } })).api.available()).toBe(false); // an older server
    expect(await client(() => ({ status: 500, body: {} })).api.available()).toBe(false);
    expect(await client(() => new Error('offline')).api.available()).toBe(false);
  });

  it('sends each step to its route and reads the job back against the contract', async () => {
    const c = client(() => ({ body: { job } }));
    expect(await c.api.propose({ kind: 'repository', query: 'a/b' })).toEqual(job);
    await c.api.job(job.id);
    await c.api.confirm(job.id);
    await c.api.cancel(job.id);
    expect(c.calls).toEqual(['POST /v1/explode/propose', 'GET /v1/explode/jobs/job-0001-0001', 'POST /v1/explode/jobs/job-0001-0001/confirm', 'DELETE /v1/explode/jobs/job-0001-0001']);
  });

  it('turns every kind of trouble into words for the learner', async () => {
    await expect(client(() => new Error('offline')).api.propose({ kind: 'repository', query: 'a/b' })).rejects.toThrow('The build server could not be reached.');
    await expect(client(() => ({ status: 429, body: { error: 'another build is running; try again when it finishes' } })).api.confirm('x')).rejects.toThrow('The build server said: another build is running; try again when it finishes.');
    await expect(client(() => ({ status: 502, body: '<html>' })).api.job('x')).rejects.toThrow('The build server answered 502.');
    await expect(client(() => ({ body: { job: { ...job, status: 'exploded' } } })).api.job('x')).rejects.toBeInstanceOf(ExplodeError);
    await expect(client(() => ({ body: {} })).api.job('x')).rejects.toThrow(/does not understand/);
    // Cancelling never throws: there is nothing the learner could do about it.
    await expect(client(() => new Error('offline')).api.cancel('x')).resolves.toBeUndefined();
  });

  it('hands over a bundle only after checking it here', async () => {
    expect((await client(() => ({ body: built })).api.bundle('x')).content_hash).toBe(built.content_hash);
    await expect(client(() => ({ body: { nope: true } })).api.bundle('x')).rejects.toThrow(/does not fit this app/);
  });
});

describe('admitting a bundle from outside the build', () => {
  const tamper = (change: (b: ContentBundle) => void) => {
    const copy = structuredClone(built);
    change(copy);
    return copy;
  };

  it('accepts what the builder made', () => {
    expect(checkedBundle(structuredClone(built)).graph.system_id).toBe('system:gh/example-org/fixture.shop@c0ffee123456');
  });

  it('refuses one that claims a recorded run, breaks a reference, or poses as a shipped system', () => {
    expect(() => checkedBundle(tamper((b) => (b.graph.nodes[0]!.truth_status = 'observed')))).toThrow(ExplodeError);
    expect(() => checkedBundle(tamper((b) => (b.graph.edges[0]!.truth_status = 'observed')))).toThrow(/did not pass its checks/);
    expect(() => checkedBundle(tamper((b) => (b.graph.edges[0]!.target_id = 'fn:nowhere#x')))).toThrow(/did not pass its checks/);
    expect(() => checkedBundle(tamper((b) => b.graph.nodes.find((n) => n.role !== 'concept')!.evidence_ids.push('ev:made:up')))).toThrow(/did not pass its checks/);
    // A shipped bundle is valid, and still not something a build may hand over under its own id.
    expect(() => checkedBundle(structuredClone(sdkJson))).toThrow(/a name this app does not accept/);
    expect(() => checkedBundle(null)).toThrow(/does not fit this app/);
  });
});

describe('finding a GitHub address in what was typed or said', () => {
  it('finds one anywhere in a sentence, or takes a bare owner/name', () => {
    expect(repoQueryIn('explode https://github.com/honojs/hono please')).toBe('https://github.com/honojs/hono');
    expect(repoQueryIn('Can you open github.com/colinhacks/zod?')).toBe('github.com/colinhacks/zod');
    expect(repoQueryIn('look at www.github.com/pmndrs/zustand.')).toBe('www.github.com/pmndrs/zustand');
    expect(repoQueryIn('  honojs/hono ')).toBe('honojs/hono');
  });

  it('leaves everything else to the assistant', () => {
    for (const t of ['what does this part do?', 'explode the zod repo', 'and/or both of them', 'https://gitlab.com/a/b', 'src/core/auth.ts is what?', '']) expect(repoQueryIn(t), t).toBeNull();
  });
});

describe('systems kept in this browser', () => {
  it('keeps the newest few, checks each on the way out, and forgets on request', async () => {
    const saved = new MemorySavedSystems();
    for (let i = 0; i < MAX_SAVED + 2; i++) {
      const copy = structuredClone(built);
      copy.graph.system_id = `system:gh/example/repo-${i}@c0ffee123456`;
      await saved.save(copy);
    }
    const list = await saved.list();
    expect(list.map((s) => s.id)).toEqual([5, 4, 3, 2].map((i) => `system:gh/example/repo-${i}@c0ffee123456`));
    // The copy's ids no longer match its layout, so reading it back is refused rather than opened.
    await expect(saved.load(list[0]!.id)).rejects.toThrow(ExplodeError);
    await saved.save(built);
    expect((await saved.load(built.graph.system_id)).content_hash).toBe(built.content_hash);
    await saved.remove(built.graph.system_id);
    await expect(saved.load(built.graph.system_id)).rejects.toThrow(/no longer saved/);
  });

  it('lists a saved system as a project that loads from storage, with the tour it will have', async () => {
    const saved = new MemorySavedSystems();
    await saved.save(built);
    const [meta] = await saved.list();
    const project = savedProject(meta!, (id) => saved.load(id));
    expect(project).toMatchObject({ id: built.graph.system_id, kind: 'software', name: 'Fixture.Shop (Example-Org/Fixture.Shop)', built: true, firstLesson: built.lessons[0]!.id, blurb: 'Built for you from its source on GitHub' });
    expect((await project.load!(() => undefined)).content_hash).toBe(built.content_hash);
  });
});

describe('a subject drafted by a model', () => {
  const draft = buildSubjectBundle(DRAFT, META);

  it('is admitted as a draft, kept, and listed as a model that nobody checked', async () => {
    expect(checkedBundle(structuredClone(draft)).graph.system_id).toMatch(/^system:ai\/lantern-world@/);
    const saved = new MemorySavedSystems();
    await saved.save(draft);
    const [meta] = await saved.list();
    expect(savedProject(meta!, (id) => saved.load(id))).toMatchObject({ kind: 'mechanical', name: 'Lantern World (AI draft)', built: true, firstLesson: draft.lessons[0]!.id, blurb: 'Drafted for you by an AI model; not checked' });
  });

  it('is refused if any of it claims to be more than a hypothesis', () => {
    const promote = (change: (b: ContentBundle) => void) => {
      const copy = structuredClone(draft);
      change(copy);
      return () => checkedBundle(copy);
    };
    // Each of these passes the ordinary integrity check or fails it; either way a draft may not carry it.
    expect(promote((b) => (b.graph.nodes[0]!.truth_status = 'authored_model'))).toThrow(ExplodeError);
    expect(promote((b) => (b.graph.edges[0]!.truth_status = 'static_verified'))).toThrow(ExplodeError);
    expect(promote((b) => b.graph.nodes[0]!.evidence_ids.push('ev:sources:read'))).toThrow(/claims more than a draft can/);
    expect(promote((b) => (b.graph.paths[0]!.truth_status = 'unknown'))).toThrow(/claims more than a draft can/);
  });
});

describe('saying how long a build will take', () => {
  it('uses the server\'s own timings, and says unknown when there are none', () => {
    expect(estimateText(null)).toBe('How long: unknown. This server has not timed a build yet.');
    expect(estimateText({ low_seconds: 5, high_seconds: 8, basis: '3 earlier builds on this server' })).toBe('How long: about 5 to 8 seconds, going by 3 earlier builds on this server.');
    expect(estimateText({ low_seconds: 6, high_seconds: 6, basis: '1 earlier build on this server' })).toBe('How long: about 6 seconds, going by 1 earlier build on this server.');
    expect(estimateText({ low_seconds: 1, high_seconds: 1, basis: 'x' })).toContain('about 1 second,');
  });
});
