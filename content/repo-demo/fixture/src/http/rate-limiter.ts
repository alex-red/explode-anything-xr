/** Fixed-window rate limiter keyed by client. */
export class RateLimiter {
  limit: number;
  windowMs: number;
  windows = new Map<string, { start: number; count: number }>();

  constructor(limit: number, windowMs: number) {
    this.limit = limit;
    this.windowMs = windowMs;
  }

  /** Count one attempt for this key and report whether it is still within the limit. */
  allow(key: string, now: number = Date.now()): boolean {
    const current = this.windows.get(key);
    if (!current || now - current.start >= this.windowMs) {
      this.windows.set(key, { start: now, count: 1 });
      return true;
    }
    current.count += 1;
    return current.count <= this.limit;
  }
}
