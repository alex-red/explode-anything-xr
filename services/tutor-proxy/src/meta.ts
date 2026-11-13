import { tutorOutputSchema, UPSTREAM_TIMEOUT_MS, type CallArgs, type UpstreamFailure, type UpstreamResult } from './anthropic.ts';

/**
 * Meta's Model API, through its OpenAI-compatible Chat Completions endpoint (docs/EXPLORE_PLAN.md
 * W12). Read from Meta's docs on Nov 11, 2026 (https://dev.meta.ai/docs/protocols/chat-completions,
 * https://dev.meta.ai/docs/structured-output); none of it has been exercised against the live API.
 */
export const META_URL = 'https://api.meta.ai/v1/chat/completions';
/** Meta's docs recommend it for "latency-sensitive turns". */
export const DEFAULT_META_MODEL = 'muse-ember-1.0';

/**
 * One non-streaming Chat Completions call with strict JSON-schema output, returning the same
 * shape as `callAnthropic`, so the handler's limits, validation and fallback apply unchanged.
 *
 * The static system prompt and the per-system graph context go first and never change for a
 * bundle, so the prompt prefix stays identical between turns (Meta bills cached input tokens at
 * a discount); only the turn text varies.
 */
export async function callMeta(args: CallArgs): Promise<UpstreamResult | UpstreamFailure> {
  const doFetch = args.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), args.timeoutMs ?? UPSTREAM_TIMEOUT_MS);
  const body = {
    model: args.model,
    messages: [
      { role: 'system', content: `${args.systemPrompt}\n\n${args.graphContext}` },
      { role: 'user', content: args.turnText },
    ],
    response_format: { type: 'json_schema', json_schema: { name: 'tutor_plan', schema: tutorOutputSchema(!!args.withCommands), strict: true } },
    // The Muse models always reason, and reasoning counts toward this budget. Low effort keeps
    // the turn inside the latency budget; whether "low" is accepted is VERIFY (spike M4): "none"
    // is documented as rejected. A 400 here falls back to the scripted tutor like any failure.
    reasoning_effort: 'low',
    max_completion_tokens: 4096,
  };
  let res: Response;
  try {
    res = await doFetch(META_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${args.apiKey}` },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    return { ok: false, reason: (err as { name?: string })?.name === 'AbortError' ? 'timeout' : 'network' };
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) return { ok: false, reason: 'http_error', status: res.status };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let data: any;
  try {
    data = await res.json();
  } catch {
    return { ok: false, reason: 'bad_output' };
  }
  const input = Number(data?.usage?.prompt_tokens ?? 0);
  const output = Number(data?.usage?.completion_tokens ?? 0);
  const tokens = input + output;
  const choice = Array.isArray(data?.choices) ? data.choices[0] : undefined;
  const message = choice?.message;
  if (choice?.finish_reason === 'content_filter' || (typeof message?.refusal === 'string' && message.refusal)) return { ok: false, reason: 'refusal', tokens };
  if (choice?.finish_reason === 'length') return { ok: false, reason: 'max_tokens', tokens };
  const text = message?.content;
  if (typeof text !== 'string') return { ok: false, reason: 'bad_output', tokens };
  try {
    return { ok: true, plan: JSON.parse(text), usage: { input_tokens: input, output_tokens: output }, model: String(data.model ?? args.model) };
  } catch {
    return { ok: false, reason: 'bad_output', tokens };
  }
}
