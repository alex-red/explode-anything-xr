import { createApp } from '../src/app/create-app.ts';
import type { HttpRequest } from '../src/http/types.ts';
import { seedDemoUsers } from '../src/users/seed.ts';

export async function demoApp() {
  const app = createApp();
  await seedDemoUsers(app.users);
  return app;
}

export function request(method: string, path: string, init: Partial<HttpRequest> = {}): HttpRequest {
  return { method, path, headers: {}, rawBody: '', clientIp: '127.0.0.1', ...init };
}
