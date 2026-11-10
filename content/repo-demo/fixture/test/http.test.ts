import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEMO_PASSWORD } from '../src/users/seed.ts';
import { demoApp, request } from './helpers.ts';

const credentials = JSON.stringify({ email: 'ada@example.com', password: DEMO_PASSWORD });

test('POST /login through the router returns a token that works for GET /me', async () => {
  const { router } = await demoApp();
  const login = await router.handle(request('POST', '/login', { rawBody: credentials }));
  assert.equal(login.status, 200);
  const { token } = login.body as { token: string };
  const me = await router.handle(request('GET', '/me', { headers: { authorization: `Bearer ${token}` } }));
  assert.equal(me.status, 200);
  assert.equal((me.body as { email: string }).email, 'ada@example.com');
});

test('POST /login with invalid JSON is rejected', async () => {
  const { router } = await demoApp();
  const res = await router.handle(request('POST', '/login', { rawBody: '{not json' }));
  assert.equal(res.status, 400);
});

test('POST /login is rate limited per client', async () => {
  const { router } = await demoApp();
  const bad = JSON.stringify({ email: 'ada@example.com', password: 'nope' });
  const statuses: number[] = [];
  for (let i = 0; i < 6; i++) statuses.push((await router.handle(request('POST', '/login', { rawBody: bad }))).status);
  assert.deepEqual(statuses, [401, 401, 401, 401, 401, 429]);
});

test('unknown routes return 404', async () => {
  const { router } = await demoApp();
  assert.equal((await router.handle(request('GET', '/nope'))).status, 404);
});
