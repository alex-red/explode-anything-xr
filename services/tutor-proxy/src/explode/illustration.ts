import { checkRateLimit, MAX_BODY_BYTES, rateLimitMax } from '../limits.ts';
import type { Env, KVLike } from '../env.ts';

export type Json = (status: number, body: unknown, headers?: Record<string, string>) => Response;

const MODEL = 'muse-image-1.0';
const ENDPOINT = 'https://api.meta.ai/v1/images/generations';
const PER_DAY = 12;
const FAILED = 'The image model did not answer.';

const UNSAFE = new RegExp('[\\u0000-\\u001f\\u007f-\\u009f\\u2028\\u2029<>`{}\\[\\]]', 'g');

/** Strip control characters, angle brackets and newlines, collapse whitespace, so user text cannot inject instructions. */
function clean(text: string, max: number): string {
  return text
    .replace(UNSAFE, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function buildPrompt(title: string, parts: string[]): string {
  const names = parts.length ? ` Its parts, named only for your reference and never written in the image: ${parts.join(', ')}.` : '';
  return (
    `A clean exploded-view technical illustration of "${title}", with its parts separated along one axis on a plain dark navy background. ` +
    `Flat, labelled-diagram style, but with no text, no lettering, no numbers, no logos, no brands and no people.${names}`
  );
}

export async function handleIllustration(request: Request, env: Env, json: Json, kv: KVLike, ip: string, fetchImpl: typeof fetch = fetch): Promise<Response> {
  if (request.method !== 'POST') return json(405, { error: 'method not allowed' }, { allow: 'POST' });
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) return json(413, { error: 'request too large' });
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return json(400, { error: 'invalid JSON' });
  }
  const b = body as { title?: unknown; parts?: unknown } | null;
  if (!b || typeof b !== 'object' || typeof b.title !== 'string' || b.title.length < 1 || b.title.length > 60) return json(400, { error: 'title must be 1 to 60 characters' });
  let parts: string[] = [];
  if (b.parts !== undefined) {
    if (!Array.isArray(b.parts) || b.parts.length > 10 || b.parts.some((p) => typeof p !== 'string' || p.length > 40)) {
      return json(400, { error: 'parts must be at most 10 strings of at most 40 characters' });
    }
    parts = (b.parts as string[]).map((p) => clean(p, 40)).filter(Boolean);
  }
  const title = clean(b.title, 60);
  if (!title) return json(400, { error: 'title must be 1 to 60 characters' });

  if (!env.META_API_KEY) return json(503, { error: 'illustrations are not available' });
  if (env.KILL_SWITCH === '1') return json(503, { error: 'illustrations are switched off' });

  const now = Date.now();
  if (!(await checkRateLimit(kv, ip, now, rateLimitMax(env.RATE_LIMIT_MAX)))) return json(429, { error: 'too many requests' });
  const key = `explode-illustration:${ip}:${new Date(now).toISOString().slice(0, 10)}`;
  const used = Number((await kv.get(key)) ?? '0');
  if (used >= PER_DAY) return json(429, { error: `this address has made ${PER_DAY} illustrations today, which is the limit` });
  await kv.put(key, String(used + 1), { expirationTtl: 2 * 86_400 });

  const prompt = buildPrompt(title, parts);
  try {
    const res = await fetchImpl(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${env.META_API_KEY}` },
      body: JSON.stringify({ model: MODEL, prompt, n: 1, size: '1024x1024', response_format: 'b64_json', output_format: 'jpeg' }),
      signal: AbortSignal.timeout(45_000),
    });
    if (!res.ok) return json(502, { error: FAILED });
    const out = (await res.json()) as { output_format?: string; data?: { b64_json?: string; url?: string }[] };
    const item = out.data?.[0];
    const type = ['png', 'jpeg', 'webp'].includes(out.output_format ?? '') ? out.output_format! : 'jpeg';
    let image: string | null = null;
    if (item?.b64_json) {
      image = `data:image/${type};base64,${item.b64_json}`;
    } else if (item?.url && /^https:\/\//.test(item.url)) {
      const img = await fetchImpl(item.url, { signal: AbortSignal.timeout(45_000) });
      if (img.ok) {
        const mime = img.headers.get('content-type')?.split(';')[0] ?? `image/${type}`;
        image = `data:${mime};base64,${Buffer.from(await img.arrayBuffer()).toString('base64')}`;
      }
    }
    if (!image) return json(502, { error: FAILED });
    return json(200, { image, model: MODEL, prompt });
  } catch {
    return json(502, { error: FAILED });
  }
}
