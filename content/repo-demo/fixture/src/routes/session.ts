import type { AuthService } from '../auth/service.ts';
import type { Handler, HttpRequest } from '../http/types.ts';
import { json } from '../http/types.ts';

/** GET /me: return the signed-in user for a bearer token. */
export function meHandler(auth: AuthService): Handler {
  return async (req) => {
    const user = auth.validate(bearerToken(req));
    if (!user) return json(401, { error: 'not_signed_in' });
    return json(200, { id: user.id, email: user.email, displayName: user.displayName });
  };
}

/** POST /logout: end the session behind a bearer token. */
export function logoutHandler(auth: AuthService): Handler {
  return async (req) => (auth.logout(bearerToken(req)) ? json(204, null) : json(401, { error: 'not_signed_in' }));
}

function bearerToken(req: HttpRequest): string {
  const header = req.headers['authorization'] ?? '';
  return header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
}
