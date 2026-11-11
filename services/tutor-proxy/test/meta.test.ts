import { describe, expect, it, vi } from 'vitest';
import { tutorOutputSchema } from '../src/anthropic.ts';
import { createRegistry } from '../src/bundles.ts';
import type { Env } from '../src/env.ts';
import { createHandler } from '../src/handler.ts';
import { MemoryKV } from '../src/limits.ts';
import { DEFAULT_META_MODEL } from '../src/meta.ts';
import { fixtureBundle } from './fixture.ts';

/** The Meta Model API provider (docs/EXPLORE_PLAN.md W12). Upstream is mocked: no network calls. */
const ORIGIN = 'https://explode.test';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const j = async (r: Response): Promise<any> => r.json();
const metaEnv: Env = { TUTOR_PROVIDER: 'meta', META_API_KEY: 'LLM_test-secret', ALLOWED_ORIGINS: ORIGIN };

const turn = { system_id: 'test-repo', revision: 'rev-1', trigger: 'explain_selection', selected_id: 'route.login', lesson_id: 'lesson.login', step_id: 's1', broken_edge_ids: [], recent_events: [] };
const post = () =>
  new Request('https://proxy.test/v1/tutor/turn', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN, 'cf-connecting-ip': '1.2.3.4' },
    body: JSON.stringify(turn),
  });
const validPlan = {
  say: 'POST /login hands the request to the auth service.',
  claim_status: 'static_verified',
  evidence_ids: ['src:route'],
  actions: [{ type: 'highlight_path', path_id: 'path.login' }],
  abstain: false,
};
/** A Chat Completions reply in the shape Meta's docs show. */
function metaReply(content: unknown, over: { finish_reason?: string; refusal?: string | null; status?: number } = {}) {
  return new Response(
    JSON.stringify({
      id: 'chatcmpl-1',
      object: 'chat.completion',
      model: 'muse-ember-1.0',
      choices: [{ index: 0, message: { role: 'assistant', content: typeof content === 'string' ? content : JSON.stringify(content), refusal: over.refusal ?? null }, finish_reason: over.finish_reason ?? 'stop' }],
      usage: { prompt_tokens: 900, completion_tokens: 120, total_tokens: 1020 },
    }),
    { status: over.status ?? 200, headers: { 'content-type': 'application/json' } },
  );
}
function setup(fetchImpl: typeof fetch, timeoutMs?: number) {
  const logs: string[] = [];
  const handle = createHandler({ registry: createRegistry([fixtureBundle]), fetchImpl, memoryKv: new MemoryKV(), log: (m) => logs.push(m), ...(timeoutMs ? { timeoutMs } : {}) });
  return { handle, logs };
}

describe('tutor proxy with the Meta provider', () => {
  it('sends one strict json_schema Chat Completions call and passes a valid plan through as live, naming the model', async () => {
    const fetchImpl = vi.fn(async () => metaReply(validPlan));
    const { handle } = setup(fetchImpl as unknown as typeof fetch);
    const res = await handle(post(), metaEnv);
    expect(await j(res)).toEqual({ plan: validPlan, source: 'live', model: 'muse-ember-1.0' });

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.meta.ai/v1/chat/completions');
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer LLM_test-secret');
    expect(headers['x-api-key']).toBeUndefined();
    const sent = JSON.parse(String(init.body));
    expect(sent.model).toBe(DEFAULT_META_MODEL);
    expect(sent.response_format.type).toBe('json_schema');
    expect(sent.response_format.json_schema.strict).toBe(true);
    expect(sent.response_format.json_schema.schema).toEqual(tutorOutputSchema());
    expect(sent.messages.map((m: { role: string }) => m.role)).toEqual(['system', 'user']);
    expect(sent.messages[0].content).toContain('<graph_data>');
    expect(sent.max_tokens).toBeUndefined(); // deprecated on Meta's endpoint
    expect(sent.reasoning_effort).not.toBe('none'); // documented as rejected
  });

  it('uses META_MODEL when set, and ignores TUTOR_MODEL', async () => {
    const fetchImpl = vi.fn(async () => metaReply(validPlan));
    const { handle } = setup(fetchImpl as unknown as typeof fetch);
    await handle(post(), { ...metaEnv, META_MODEL: 'muse-spark-1.3', TUTOR_MODEL: 'claude-sonnet-5-5' });
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body)).model).toBe('muse-spark-1.3');
  });

  it.each([
    ['an HTTP error', () => metaReply(validPlan, { status: 429 }), 'http_error'],
    ['a refusal', () => metaReply('', { refusal: 'I cannot help with that.' }), 'refusal'],
    ['a content filter stop', () => metaReply(validPlan, { finish_reason: 'content_filter' }), 'refusal'],
    ['a length cut-off', () => metaReply('{"say": "POST', { finish_reason: 'length' }), 'max_tokens'],
    ['text that is not JSON', () => metaReply('not json'), 'bad_output'],
    ['a plan that fails validation', () => metaReply({ ...validPlan, actions: [{ type: 'reset_experiment' }] }), 'invalid_plan'],
  ])('falls back to the scripted tutor on %s', async (_name, reply, reason) => {
    const { handle, logs } = setup((async () => reply()) as unknown as typeof fetch);
    const res = await handle(post(), metaEnv);
    expect(res.status).toBe(200);
    expect(res.headers.get('x-tutor-fallback')).toBe(reason);
    expect((await j(res)).source).toBe('scripted');
    expect(logs.join('\n')).not.toContain('LLM_test-secret');
  });

  it('falls back on a timeout', async () => {
    const hang = ((_u: string, init: RequestInit) =>
      new Promise((_r, reject) => init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))))) as unknown as typeof fetch;
    const { handle } = setup(hang, 20);
    const res = await handle(post(), metaEnv);
    expect(res.headers.get('x-tutor-fallback')).toBe('timeout');
  });

  it('answers scripted without a Meta key, even when an Anthropic key is set', async () => {
    const fetchImpl = vi.fn(async () => metaReply(validPlan));
    const { handle } = setup(fetchImpl as unknown as typeof fetch);
    const res = await handle(post(), { TUTOR_PROVIDER: 'meta', ANTHROPIC_API_KEY: 'sk-other', ALLOWED_ORIGINS: ORIGIN });
    expect(res.headers.get('x-tutor-fallback')).toBe('no_api_key');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('health names the provider and model, never the key', async () => {
    const { handle } = setup((async () => metaReply(validPlan)) as unknown as typeof fetch);
    const res = await handle(new Request('https://proxy.test/v1/health'), metaEnv);
    const text = await res.text();
    expect(JSON.parse(text)).toMatchObject({ provider: 'meta', model: 'muse-ember-1.0' });
    expect(text).not.toContain('LLM_');
  });

  it("the output schema meets Meta's strict-mode rules", () => {
    const schema = tutorOutputSchema() as Record<string, unknown>;
    expect(schema.type).toBe('object'); // a plain object at the root
    for (const k of ['anyOf', 'oneOf', 'allOf', 'enum', 'not']) expect(schema[k], `root ${k}`).toBeUndefined();
    const text = JSON.stringify(schema);
    expect(text).not.toContain('"oneOf"');
    expect(text).not.toContain('"allOf"');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const walk = (n: any, at: string) => {
      if (!n || typeof n !== 'object') return;
      if (n.type === 'object' && n.properties) {
        expect(n.additionalProperties, `${at} additionalProperties`).toBe(false);
        expect([...(n.required ?? [])].sort(), `${at} requires every key`).toEqual(Object.keys(n.properties).sort());
      }
      for (const [k, v] of Object.entries(n)) walk(v, `${at}.${k}`);
    };
    walk(schema, '$');
  });
});
