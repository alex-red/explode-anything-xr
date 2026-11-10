import type { TutorPlan, TutorTurnRequest, TutorTurnResponse } from '@explode/contracts';
import { TutorTurnRequest as TutorTurnRequestSchema } from '@explode/contracts';
import { scriptedTutorTurn, validateTutorPlan } from '@explode/lesson-engine';
import { callAnthropic } from './anthropic.ts';
import type { BundleRegistry } from './bundles.ts';
import { buildGraphContext, buildTurnText, stateFromRequest, SYSTEM_PROMPT } from './context.ts';
import { DEFAULT_MODEL, PROXY_VERSION, type Env, type KVLike } from './env.ts';
import { checkRateLimit, estimateTokens, MAX_BODY_BYTES, MemoryKV, parseCap, recordSpend, spentToday } from './limits.ts';

export interface HandlerDeps {
  registry: BundleRegistry;
  fetchImpl?: typeof fetch;
  now?: () => number;
  /** Used when env.TUTOR_KV is unbound. */
  memoryKv?: KVLike;
  timeoutMs?: number;
  log?: (msg: string) => void;
}

type FallbackReason = string;

export function createHandler(deps: HandlerDeps) {
  const memoryKv = deps.memoryKv ?? new MemoryKV();
  const now = deps.now ?? Date.now;
  const log = deps.log ?? ((m: string) => console.log(m));
  const graphContextCache = new Map<string, string>();

  return async function handle(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get('origin');
    const allowed = (env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    const originOk = origin === null || allowed.includes(origin);
    const cors: Record<string, string> = { vary: 'Origin' };
    if (origin && originOk) {
      cors['access-control-allow-origin'] = origin;
      cors['access-control-allow-methods'] = 'POST, GET, OPTIONS';
      cors['access-control-allow-headers'] = 'content-type';
      cors['access-control-max-age'] = '86400';
    }
    const json = (status: number, body: unknown, extra: Record<string, string> = {}) =>
      new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...cors, ...extra } });

    if (!originOk) return json(403, { error: 'origin not allowed' });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    const model = env.TUTOR_MODEL || DEFAULT_MODEL;
    const killed = env.KILL_SWITCH === '1';

    if (url.pathname === '/v1/health' && request.method === 'GET') {
      return json(200, { ok: true, version: PROXY_VERSION, killed, model });
    }
    if (url.pathname !== '/v1/tutor/turn') return json(404, { error: 'not found' });
    if (request.method !== 'POST') return json(405, { error: 'method not allowed' });

    const declared = Number(request.headers.get('content-length') ?? '0');
    if (declared > MAX_BODY_BYTES) return json(413, { error: 'body too large' });
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) return json(413, { error: 'body too large' });

    const kv = env.TUTOR_KV ?? memoryKv;
    const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
    if (!(await checkRateLimit(kv, ip, now()))) return json(429, { error: 'rate limited' }, { 'retry-after': '600' });

    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return json(400, { error: 'invalid json' });
    }
    const parsed = TutorTurnRequestSchema.safeParse(body);
    if (!parsed.success) return json(400, { error: 'invalid request', issues: parsed.error.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.message}`) });
    const req: TutorTurnRequest = parsed.data;

    const entry = deps.registry.get(req.system_id);
    if (!entry) return json(404, { error: 'unknown system' });
    if (entry.bundle.graph.revision.value !== req.revision) {
      return json(409, { error: 'revision mismatch', expected: entry.bundle.graph.revision.value });
    }
    const { bundle, ctx } = entry;

    const scripted = (reason: FallbackReason): Response => {
      const plan: TutorPlan = scriptedTutorTurn(ctx, stateFromRequest(ctx, req), { trigger: req.trigger, selected_id: req.selected_id });
      const out: TutorTurnResponse = { plan, source: 'scripted' };
      return json(200, out, { 'x-tutor-fallback': reason });
    };

    if (killed) return scripted('kill_switch');
    if (!env.ANTHROPIC_API_KEY) return scripted('no_api_key');

    let graphContext = graphContextCache.get(bundle.content_hash);
    if (!graphContext) {
      graphContext = buildGraphContext(bundle);
      graphContextCache.set(bundle.content_hash, graphContext);
    }
    const turnText = buildTurnText(ctx, req);
    const estimate = estimateTokens(SYSTEM_PROMPT + graphContext + turnText) + 600;
    const cap = parseCap(env.DAILY_TOKEN_CAP);
    if ((await spentToday(kv, now())) + estimate > cap) return scripted('daily_cap');

    const result = await callAnthropic({
      apiKey: env.ANTHROPIC_API_KEY,
      model,
      systemPrompt: SYSTEM_PROMPT,
      graphContext,
      turnText,
      timeoutMs: deps.timeoutMs,
      ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
    });

    if (!result.ok) {
      await recordSpend(kv, now(), result.tokens ?? 0);
      log(`tutor fallback: ${result.reason}${result.status ? ` (${result.status})` : ''}`);
      return scripted(result.reason);
    }
    const u = result.usage;
    await recordSpend(kv, now(), (u.input_tokens ?? 0) + (u.output_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) * 0.1);

    const validation = validateTutorPlan(ctx, result.plan);
    if (!validation.ok) {
      log(`tutor plan rejected: ${validation.errors.slice(0, 3).join('; ')}`);
      return scripted('invalid_plan');
    }
    const out: TutorTurnResponse = { plan: validation.plan, source: 'live', model: result.model };
    return json(200, out);
  };
}
