/** Minimal structural types for the Workers runtime, so this package typechecks with plain Node types. */
export interface KVLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

export interface Env {
  /** Secret (`wrangler secret put ANTHROPIC_API_KEY`). Never logged. Absent → scripted only. */
  ANTHROPIC_API_KEY?: string;
  /** Defaults to claude-haiku-5-5. */
  TUTOR_MODEL?: string;
  /** Comma-separated list of origins allowed to call the proxy, e.g. "https://explode.example". */
  ALLOWED_ORIGINS?: string;
  /** Estimated tokens per UTC day before the proxy goes scripted-only. Default 2,000,000. */
  DAILY_TOKEN_CAP?: string;
  /** "1" forces scripted responses for every request. */
  KILL_SWITCH?: string;
  /** Optional KV namespace for rate limits and the spend counter. In-memory fallback when unbound. */
  TUTOR_KV?: KVLike;
}

export const DEFAULT_MODEL = 'claude-haiku-5-5';
export const PROXY_VERSION = '0.1.0';
