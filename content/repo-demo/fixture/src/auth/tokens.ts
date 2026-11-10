import { createHmac, timingSafeEqual } from 'node:crypto';

function signature(sessionId: string, secret: string): string {
  return createHmac('sha256', secret).update(sessionId).digest('base64url');
}

/** Sign a session id with HMAC-SHA256. Token format: "<sessionId>.<signature>". */
export function signToken(sessionId: string, secret: string): string {
  return `${sessionId}.${signature(sessionId, secret)}`;
}

/** Verify a token's signature and return its session id, or null if it was tampered with. */
export function verifyToken(token: string, secret: string): string | null {
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const sessionId = token.slice(0, dot);
  const given = Buffer.from(token.slice(dot + 1));
  const expected = Buffer.from(signature(sessionId, secret));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  return sessionId;
}
