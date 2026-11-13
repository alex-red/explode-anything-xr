import type { TutorPlan, TutorTurnRequest, TutorTurnResponse } from '@explode/contracts';
import { TutorTurnRequest as TutorTurnRequestSchema } from '@explode/contracts';
import { commandScopeOf, scriptedTutorTurn, validateTutorPlan } from '@explode/lesson-engine';
import { callAnthropic } from './anthropic.ts';
import { callMeta, DEFAULT_META_MODEL } from './meta.ts';
import type { BundleRegistry } from './bundles.ts';
import { buildGraphContext, buildTurnText, stateFromRequest, SYSTEM_PROMPT } from './context.ts';
import { DEFAULT_MODEL, PROXY_VERSION, type Env, type KVLike } from './env.ts';
import { callTranscribe } from './transcribe.ts';
import { audioToday, checkRateLimit, DEFAULT_DAILY_AUDIO_SECONDS, estimateTokens, MAX_AUDIO_BYTES, MAX_BODY_BYTES, MemoryKV, parseCap, recordAudio, recordSpend, spentToday } from './limits.ts';

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
/** Upstream calls per turn: the first, and one retry after a plan that failed validation. */
const MAX_ATTEMPTS = 2;
/** Fallbacks where the live tutor was never asked. */
const OFFLINE_REASONS: ReadonlySet<string> = new Set(['kill_switch', 'no_api_key', 'daily_cap']);

export function createHandler(deps: HandlerDeps) {
  const memoryKv = deps.memoryKv ?? new MemoryKV();
  const now = deps.now ?? Date.now;
  const log = deps.log ?? ((m: string) => console.log(m));
  const graphContextCache = new Map<string, string>();

  /**
   * One spoken question (a 16 kHz mono WAV) to text. The text is only ever used as the learner's
   * question in a later turn, where it is wrapped as untrusted data like typed text.
   */
  async function transcribe(request: Request, env: Env, killed: boolean, json: (status: number, body: unknown, extra?: Record<string, string>) => Response): Promise<Response> {
    if (Number(request.headers.get('content-length') ?? '0') > MAX_AUDIO_BYTES) return json(413, { error: 'audio too long' });
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.byteLength > MAX_AUDIO_BYTES) return json(413, { error: 'audio too long' });
    const kv = env.TUTOR_KV ?? memoryKv;
    const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
    if (!(await checkRateLimit(kv, ip, now()))) return json(429, { error: 'rate limited' }, { 'retry-after': '600' });
    const tag = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4));
    if (bytes.byteLength <= 44 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return json(400, { error: 'expected a wav file' });
    if (killed || !env.META_API_KEY) return json(503, { error: 'speech-to-text unavailable' });
    const seconds = (bytes.byteLength - 44) / 32_000;
    const cap = Number(env.DAILY_AUDIO_SECONDS_CAP) > 0 ? Number(env.DAILY_AUDIO_SECONDS_CAP) : DEFAULT_DAILY_AUDIO_SECONDS;
    if ((await audioToday(kv, now())) + seconds > cap) return json(429, { error: 'daily voice cap reached' });
    await recordAudio(kv, now(), seconds);
    const result = await callTranscribe({ apiKey: env.META_API_KEY, wav: bytes, timeoutMs: deps.timeoutMs, ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}) });
    if (!result.ok) {
      log(`transcribe failed: ${result.reason}${result.status ? ` (${result.status})` : ''}`);
      return json(502, { error: 'speech-to-text failed' });
    }
    return json(200, { text: result.text.slice(0, 300) });
  }

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

    // One provider per deployment: Anthropic by default, Meta's Model API when asked for.
    const provider = env.TUTOR_PROVIDER === 'meta' ? 'meta' : 'anthropic';
    const model = provider === 'meta' ? env.META_MODEL || DEFAULT_META_MODEL : env.TUTOR_MODEL || DEFAULT_MODEL;
    const apiKey = provider === 'meta' ? env.META_API_KEY : env.ANTHROPIC_API_KEY;
    const killed = env.KILL_SWITCH === '1';

    if (url.pathname === '/v1/health' && request.method === 'GET') {
      return json(200, { ok: true, version: PROXY_VERSION, killed, provider, model });
    }
    if (url.pathname === '/v1/tutor/transcribe') {
      if (request.method !== 'POST') return json(405, { error: 'method not allowed' });
      return transcribe(request, env, killed, json);
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
      let plan: TutorPlan = scriptedTutorTurn(ctx, stateFromRequest(ctx, req), { trigger: req.trigger, selected_id: req.selected_id });
      // The live tutor was reached but gave nothing usable: say that, not "needs the online tutor".
      if (req.trigger === 'free_text' && !OFFLINE_REASONS.has(reason)) plan = { ...plan, say: 'I could not answer that reliably just now. Ask it another way, or select a part and press Explain this.' };
      const out: TutorTurnResponse = { plan, source: 'scripted' };
      return json(200, out, { 'x-tutor-fallback': reason });
    };

    if (killed) return scripted('kill_switch');
    if (!apiKey) return scripted('no_api_key');

    let graphContext = graphContextCache.get(bundle.content_hash);
    if (!graphContext) {
      graphContext = buildGraphContext(bundle);
      graphContextCache.set(bundle.content_hash, graphContext);
    }
    const turnText = buildTurnText(ctx, req);
    const scope = commandScopeOf(req);
    const estimate = estimateTokens(SYSTEM_PROMPT + graphContext + turnText) + 600;
    const cap = parseCap(env.DAILY_TOKEN_CAP);
    if ((await spentToday(kv, now())) + estimate > cap) return scripted('daily_cap');

    // A plan that fails validation gets one more try, told exactly what was wrong (most often an
    // id that does not exist). A second failure, or any upstream failure, is the scripted answer.
    let attemptText = turnText;
    let accepted: { plan: TutorPlan; model: string } | null = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS && !accepted; attempt++) {
      const result = await (provider === 'meta' ? callMeta : callAnthropic)({
        apiKey,
        model,
        systemPrompt: SYSTEM_PROMPT,
        graphContext,
        turnText: attemptText,
        withCommands: scope !== null,
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

      const validation = validateTutorPlan(ctx, result.plan, scope);
      if (validation.ok) accepted = { plan: validation.plan, model: result.model };
      else {
        const errors = validation.errors.slice(0, 5).join('; ');
        log(`tutor plan rejected (attempt ${attempt}): ${errors}`);
        attemptText = `${turnText}\nYour previous plan was rejected: ${errors}. Use only ids that appear in the GRAPH DATA; if there is no evidence for a claim, cite none and lower claim_status. Return a corrected JSON plan.`;
      }
    }
    if (!accepted) return scripted('invalid_plan');
    const out: TutorTurnResponse = { plan: accepted.plan, source: 'live', model: accepted.model };
    return json(200, out);
  };
}
