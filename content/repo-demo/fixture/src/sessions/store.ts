import { randomUUID } from 'node:crypto';
import { signToken, verifyToken } from '../auth/tokens.ts';

export interface Session {
  id: string;
  userId: string;
  token: string;
  expiresAt: number;
}

/** In-memory session store. Sessions expire after the configured time to live. */
export class SessionStore {
  sessions = new Map<string, Session>();
  secret: string;
  ttlMs: number;

  constructor(secret: string, ttlMs: number) {
    this.secret = secret;
    this.ttlMs = ttlMs;
  }

  /** Create a session for a user and sign its token. */
  create(userId: string, now: number = Date.now()): Session {
    const id = randomUUID();
    const session: Session = { id, userId, token: signToken(id, this.secret), expiresAt: now + this.ttlMs };
    this.sessions.set(id, session);
    return session;
  }

  /** Look up a live session from its signed token. */
  findByToken(token: string, now: number = Date.now()): Session | null {
    const id = verifyToken(token, this.secret);
    if (!id) return null;
    const session = this.sessions.get(id);
    if (!session || session.expiresAt <= now) return null;
    return session;
  }

  /** End a session. Returns false when the token was not live. */
  revoke(token: string): boolean {
    const session = this.findByToken(token);
    return session ? this.sessions.delete(session.id) : false;
  }
}
