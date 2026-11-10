import type { AuditLog } from '../audit/log.ts';
import type { SessionStore } from '../sessions/store.ts';
import type { User, UserRepository } from '../users/repository.ts';
import { verifyPassword } from './password.ts';

export type LoginResult =
  | { ok: true; token: string; expiresAt: number; userId: string }
  | { ok: false; reason: 'invalid_credentials' };

/** Authenticates users and issues sessions. */
export class AuthService {
  users: UserRepository;
  sessions: SessionStore;
  audit: AuditLog;

  constructor(users: UserRepository, sessions: SessionStore, audit: AuditLog) {
    this.users = users;
    this.sessions = sessions;
    this.audit = audit;
  }

  /** Check credentials and, if they are valid, create a signed session. */
  async login(email: string, password: string): Promise<LoginResult> {
    const user = this.users.findByEmail(email);
    if (!user) {
      this.audit.record('login_failed', { email, reason: 'unknown_user' });
      return { ok: false, reason: 'invalid_credentials' };
    }
    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      this.audit.record('login_failed', { email, reason: 'bad_password' });
      return { ok: false, reason: 'invalid_credentials' };
    }
    const session = this.sessions.create(user.id);
    this.audit.record('login_succeeded', { userId: user.id });
    return { ok: true, token: session.token, expiresAt: session.expiresAt, userId: user.id };
  }

  /** Resolve a bearer token to its user, or null when it is invalid or expired. */
  validate(token: string): User | null {
    const session = this.sessions.findByToken(token);
    return session ? this.users.findById(session.userId) : null;
  }

  /** End the session behind a token. */
  logout(token: string): boolean {
    const ended = this.sessions.revoke(token);
    if (ended) this.audit.record('logout', {});
    return ended;
  }
}
