import type { KVLike } from './env.ts';

export const RATE_LIMIT_MAX = 20;
export const RATE_LIMIT_WINDOW_S = 600;
export const MAX_BODY_BYTES = 16 * 1024;
export const DEFAULT_DAILY_TOKEN_CAP = 2_000_000;
/** One spoken question: a 44-byte WAV header and at most 12 s of 16 kHz 16-bit mono. */
export const MAX_AUDIO_BYTES = 44 + 16_000 * 2 * 12;
/** Seconds of speech transcribed per UTC day before voice is refused. */
export const DEFAULT_DAILY_AUDIO_SECONDS = 3_600;

/** In-memory fallback store (per isolate) used when no KV namespace is bound. */
export class MemoryKV implements KVLike {
  private readonly data = new Map<string, { value: string; expires: number }>();
  private readonly now: () => number;
  constructor(now: () => number = Date.now) {
    this.now = now;
  }
  async get(key: string): Promise<string | null> {
    const hit = this.data.get(key);
    if (!hit) return null;
    if (hit.expires <= this.now()) {
      this.data.delete(key);
      return null;
    }
    return hit.value;
  }
  async put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void> {
    const ttl = options?.expirationTtl ?? 86_400;
    this.data.set(key, { value, expires: this.now() + ttl * 1000 });
  }
}

/** Requests one address may make per window: `RATE_LIMIT_MAX` from the environment when it is a positive whole number, else 20. */
export function rateLimitMax(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : RATE_LIMIT_MAX;
}

/** Fixed-window per-IP limit. Returns true when the request is allowed. KV is eventually consistent; this is abuse damping, not billing. */
export async function checkRateLimit(kv: KVLike, ip: string, nowMs: number, max = RATE_LIMIT_MAX): Promise<boolean> {
  const window = Math.floor(nowMs / 1000 / RATE_LIMIT_WINDOW_S);
  const key = `rl:${ip}:${window}`;
  const count = Number((await kv.get(key)) ?? '0');
  if (count >= max) return false;
  await kv.put(key, String(count + 1), { expirationTtl: RATE_LIMIT_WINDOW_S });
  return true;
}

function dayKey(nowMs: number): string {
  return `spend:${new Date(nowMs).toISOString().slice(0, 10)}`;
}

export async function spentToday(kv: KVLike, nowMs: number): Promise<number> {
  return Number((await kv.get(dayKey(nowMs))) ?? '0');
}

export async function recordSpend(kv: KVLike, nowMs: number, tokens: number): Promise<void> {
  const current = await spentToday(kv, nowMs);
  await kv.put(dayKey(nowMs), String(current + Math.max(0, Math.round(tokens))), { expirationTtl: 2 * 86_400 });
}

export function parseCap(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_DAILY_TOKEN_CAP;
}

/** Rough token estimate (~4 chars per token) used before a call, to check the cap. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function audioKey(nowMs: number): string {
  return `audio:${new Date(nowMs).toISOString().slice(0, 10)}`;
}

export async function audioToday(kv: KVLike, nowMs: number): Promise<number> {
  return Number((await kv.get(audioKey(nowMs))) ?? '0');
}

export async function recordAudio(kv: KVLike, nowMs: number, seconds: number): Promise<void> {
  const current = await audioToday(kv, nowMs);
  await kv.put(audioKey(nowMs), String(current + Math.max(0, seconds)), { expirationTtl: 2 * 86_400 });
}
