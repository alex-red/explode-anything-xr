import { TUTOR_ACTION_TYPES, tutorPlanJsonSchema } from '@explode/contracts';

export const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
export const ANTHROPIC_VERSION = '2023-06-01';
export const UPSTREAM_TIMEOUT_MS = 5_000;

/** Structured outputs don't accept numeric/length/count constraints; those are re-checked client- and server-side by Zod. */
const DROP_KEYS = new Set(['$schema', 'minLength', 'maxLength', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'minItems', 'maxItems', 'pattern', 'multipleOf']);

function sanitize(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(sanitize);
  if (node === null || typeof node !== 'object') return node;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if (DROP_KEYS.has(k)) continue;
    out[k === 'oneOf' ? 'anyOf' : k] = sanitize(v);
  }
  if (out.type === 'object' && !('additionalProperties' in out)) out.additionalProperties = false;
  return out;
}

let cachedSchema: Record<string, unknown> | undefined;

/** The TutorPlan schema, restricted to the tutor action allowlist and made structured-outputs compatible. */
export function tutorOutputSchema(): Record<string, unknown> {
  if (cachedSchema) return cachedSchema;
  const schema = sanitize(tutorPlanJsonSchema()) as Record<string, any>;
  const allowed = new Set<string>(TUTOR_ACTION_TYPES);
  const items = schema.properties.actions.items as { anyOf: Array<{ properties: { type: { const: string } } }> };
  items.anyOf = items.anyOf.filter((v) => allowed.has(v.properties.type.const));
  cachedSchema = schema;
  return schema;
}

export interface UpstreamResult {
  ok: true;
  plan: unknown;
  usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
  model: string;
}
export interface UpstreamFailure {
  ok: false;
  reason: 'timeout' | 'http_error' | 'network' | 'refusal' | 'max_tokens' | 'bad_output';
  status?: number;
  tokens?: number;
}

export interface CallArgs {
  apiKey: string;
  model: string;
  systemPrompt: string;
  graphContext: string;
  turnText: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/**
 * One non-streaming Messages API call with JSON-schema structured output.
 * Prompt caching: the static system prompt and per-system graph context are separate system blocks;
 * the breakpoint on the graph block caches both. Only the turn text varies per request.
 */
export async function callAnthropic(args: CallArgs): Promise<UpstreamResult | UpstreamFailure> {
  const doFetch = args.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), args.timeoutMs ?? UPSTREAM_TIMEOUT_MS);
  const body = {
    model: args.model,
    max_tokens: 2048,
    system: [
      { type: 'text', text: args.systemPrompt },
      { type: 'text', text: args.graphContext, cache_control: { type: 'ephemeral' } },
    ],
    messages: [{ role: 'user', content: args.turnText }],
    // Low effort keeps latency inside the 5 s budget; thinking stays adaptive (default on Haiku 5.5).
    output_config: { effort: 'low', format: { type: 'json_schema', schema: tutorOutputSchema() } },
  };
  let res: Response;
  try {
    res = await doFetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': args.apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    return { ok: false, reason: (err as { name?: string })?.name === 'AbortError' ? 'timeout' : 'network' };
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) return { ok: false, reason: 'http_error', status: res.status };

  let data: any;
  try {
    data = await res.json();
  } catch {
    return { ok: false, reason: 'bad_output' };
  }
  const usage = data?.usage ?? { input_tokens: 0, output_tokens: 0 };
  const tokens = (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0);
  if (data?.stop_reason === 'refusal') return { ok: false, reason: 'refusal', tokens };
  if (data?.stop_reason === 'max_tokens') return { ok: false, reason: 'max_tokens', tokens };
  const text = Array.isArray(data?.content) ? data.content.find((b: any) => b?.type === 'text')?.text : undefined;
  if (typeof text !== 'string') return { ok: false, reason: 'bad_output', tokens };
  try {
    return { ok: true, plan: JSON.parse(text), usage, model: String(data.model ?? args.model) };
  } catch {
    return { ok: false, reason: 'bad_output', tokens };
  }
}
