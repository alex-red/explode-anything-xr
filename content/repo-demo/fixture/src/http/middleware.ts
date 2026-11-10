import type { Handler, HttpRequest, HttpResponse, Next } from './types.ts';
import { json } from './types.ts';
import type { RateLimiter } from './rate-limiter.ts';

/** Reject clients that exceed their attempt budget before any credential check runs. */
export function rateLimit(limiter: RateLimiter): Handler {
  return async (req, next) => {
    if (!limiter.allow(req.clientIp)) return json(429, { error: 'too_many_attempts' });
    return next();
  };
}

/** Parse the raw JSON request body into req.body. */
export async function parseJsonBody(req: HttpRequest, next: Next): Promise<HttpResponse> {
  try {
    req.body = req.rawBody ? JSON.parse(req.rawBody) : {};
  } catch {
    return json(400, { error: 'invalid_json' });
  }
  return next();
}
