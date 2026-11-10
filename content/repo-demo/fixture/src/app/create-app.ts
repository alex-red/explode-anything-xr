import { AuditLog } from '../audit/log.ts';
import { AuthService } from '../auth/service.ts';
import { loadSettings } from '../config/settings.ts';
import type { Settings } from '../config/settings.ts';
import { parseJsonBody, rateLimit } from '../http/middleware.ts';
import { RateLimiter } from '../http/rate-limiter.ts';
import { Router } from '../http/router.ts';
import { loginHandler } from '../routes/login.ts';
import { logoutHandler, meHandler } from '../routes/session.ts';
import { SessionStore } from '../sessions/store.ts';
import { UserRepository } from '../users/repository.ts';

export interface App {
  router: Router;
  auth: AuthService;
  users: UserRepository;
  audit: AuditLog;
}

/** Wire the service: stores, authentication, rate limiting, and routes. */
export function createApp(settings: Settings = loadSettings()): App {
  const users = new UserRepository();
  const sessions = new SessionStore(settings.sessionSecret, settings.sessionTtlMs);
  const audit = new AuditLog();
  const auth = new AuthService(users, sessions, audit);
  const limiter = new RateLimiter(settings.loginAttemptsPerMinute, 60_000);

  const router = new Router();
  router.post('/login', rateLimit(limiter), parseJsonBody, loginHandler(auth));
  router.get('/me', meHandler(auth));
  router.post('/logout', logoutHandler(auth));
  return { router, auth, users, audit };
}
