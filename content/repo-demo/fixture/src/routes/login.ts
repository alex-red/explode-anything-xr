import type { AuthService } from '../auth/service.ts';
import type { Handler } from '../http/types.ts';
import { json } from '../http/types.ts';

/** POST /login: exchange an email and password for a signed session token. */
export function loginHandler(auth: AuthService): Handler {
  return async (req) => {
    const { email, password } = readCredentials(req.body);
    if (!email || !password) return json(400, { error: 'missing_credentials' });
    const result = await auth.login(email, password);
    if (!result.ok) return json(401, { error: result.reason });
    return json(200, { token: result.token, expiresAt: result.expiresAt });
  };
}

function readCredentials(body: unknown): { email?: string; password?: string } {
  if (typeof body !== 'object' || body === null) return {};
  const { email, password } = body as Record<string, unknown>;
  return {
    email: typeof email === 'string' ? email : undefined,
    password: typeof password === 'string' ? password : undefined,
  };
}
