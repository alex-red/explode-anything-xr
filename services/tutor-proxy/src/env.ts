/** A key-value store for the rate-limit windows and spend counters; in memory unless one is supplied. */
export interface KVLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

export interface Env {
  /** Secret, from the environment. Never logged. Absent → scripted only. */
  ANTHROPIC_API_KEY?: string;
  /** Defaults to claude-haiku-5-5. Used when the provider is anthropic. */
  TUTOR_MODEL?: string;
  /** Which model API answers live turns: "anthropic" (default) or "meta" (docs/EXPLORE_PLAN.md W12). */
  TUTOR_PROVIDER?: string;
  /** Secret, from the environment. Never logged. Absent with provider meta → scripted only. Also the key for speech to text, whichever provider answers turns. */
  META_API_KEY?: string;
  /** Defaults to muse-ember-1.0. Used when the provider is meta. */
  META_MODEL?: string;
  /** Comma-separated list of origins allowed to call the proxy, e.g. "https://explode.example". */
  ALLOWED_ORIGINS?: string;
  /** Estimated tokens per UTC day before the proxy goes scripted-only. Default 2,000,000. */
  DAILY_TOKEN_CAP?: string;
  /** "1" forces scripted responses for every request. */
  KILL_SWITCH?: string;
  /** Optional store for rate limits and the spend counter. In-memory fallback when absent. */
  TUTOR_KV?: KVLike;
  /** Seconds of speech transcribed per UTC day. Default 3600. */
  DAILY_AUDIO_SECONDS_CAP?: string;
  /** Optional GitHub token for Explode Anything: a higher rate limit only. Public repositories need none. Never logged. */
  GITHUB_TOKEN?: string;
  /** The model that groups a repository's parts. Default: the tutor's model for the provider in use. */
  EXPLODE_MODEL?: string;
  /** Builds one address may start per UTC day. Default 5. */
  EXPLODE_BUILDS_PER_DAY?: string;
  /** Requests one address may make per 10 minutes, across tutor turns, transcriptions and proposals. Default 20. Raised only for local capture. */
  RATE_LIMIT_MAX?: string;
}

export const DEFAULT_MODEL = 'claude-haiku-5-5';
export const PROXY_VERSION = '0.5.0';
