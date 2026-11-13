import { ANTHROPIC_URL, ANTHROPIC_VERSION } from '../anthropic.ts';
import { META_URL } from '../meta.ts';

/**
 * One JSON answer from the model that curates a repository (ADR-0026). The same two providers as
 * the tutor, with a longer time limit: this is asked once per build, not once per turn.
 *
 * What it returns is text. It is parsed and checked against the index by the build before any of
 * it is used; nothing here trusts it.
 */

export interface ModelMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AskArgs {
  provider: 'anthropic' | 'meta';
  apiKey: string;
  model: string;
  system: string;
  messages: ModelMessage[];
  schema: Record<string, unknown>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export type AskResult = { ok: true; text: string; model: string; tokens: number } | { ok: false; reason: string; tokens: number };

export const CURATION_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_TOKENS = 8192;

export async function askJson(args: AskArgs): Promise<AskResult> {
  const doFetch = args.fetchImpl ?? fetch;
  const signal = AbortSignal.timeout(args.timeoutMs ?? CURATION_TIMEOUT_MS);
  const meta = args.provider === 'meta';
  const body = meta
    ? {
        model: args.model,
        messages: [{ role: 'system', content: args.system }, ...args.messages],
        response_format: { type: 'json_schema', json_schema: { name: 'curation', schema: args.schema, strict: true } },
        reasoning_effort: 'low',
        max_completion_tokens: MAX_OUTPUT_TOKENS,
      }
    : {
        model: args.model,
        max_tokens: MAX_OUTPUT_TOKENS,
        system: args.system,
        messages: args.messages,
        output_config: { effort: 'low', format: { type: 'json_schema', schema: args.schema } },
      };
  let res: Response;
  try {
    res = await doFetch(meta ? META_URL : ANTHROPIC_URL, {
      method: 'POST',
      headers: meta
        ? { 'content-type': 'application/json', authorization: `Bearer ${args.apiKey}` }
        : { 'content-type': 'application/json', 'x-api-key': args.apiKey, 'anthropic-version': ANTHROPIC_VERSION },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    const name = (err as { name?: string })?.name;
    return { ok: false, reason: name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network', tokens: 0 };
  }
  if (!res.ok) return { ok: false, reason: `http_${res.status}`, tokens: 0 };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let data: any;
  try {
    data = await res.json();
  } catch {
    return { ok: false, reason: 'bad_output', tokens: 0 };
  }
  if (meta) {
    const tokens = Number(data?.usage?.total_tokens ?? 0);
    const choice = Array.isArray(data?.choices) ? data.choices[0] : undefined;
    if (choice?.finish_reason === 'content_filter' || choice?.message?.refusal) return { ok: false, reason: 'refusal', tokens };
    if (choice?.finish_reason === 'length') return { ok: false, reason: 'max_tokens', tokens };
    const text = choice?.message?.content;
    return typeof text === 'string' ? { ok: true, text, model: String(data.model ?? args.model), tokens } : { ok: false, reason: 'bad_output', tokens };
  }
  const usage = data?.usage ?? {};
  const tokens = Number(usage.input_tokens ?? 0) + Number(usage.output_tokens ?? 0);
  if (data?.stop_reason === 'refusal') return { ok: false, reason: 'refusal', tokens };
  if (data?.stop_reason === 'max_tokens') return { ok: false, reason: 'max_tokens', tokens };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const text = Array.isArray(data?.content) ? data.content.find((b: any) => b?.type === 'text')?.text : undefined;
  return typeof text === 'string' ? { ok: true, text, model: String(data.model ?? args.model), tokens } : { ok: false, reason: 'bad_output', tokens };
}
