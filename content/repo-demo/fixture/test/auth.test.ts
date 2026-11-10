import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEMO_PASSWORD } from '../src/users/seed.ts';
import { demoApp } from './helpers.ts';

test('login succeeds with the right password and returns a token', async () => {
  const { auth } = await demoApp();
  const result = await auth.login('ada@example.com', DEMO_PASSWORD);
  assert.equal(result.ok, true);
  assert.ok(result.ok && result.token.length > 20);
});

test('login rejects a wrong password', async () => {
  const { auth, audit } = await demoApp();
  const result = await auth.login('ada@example.com', 'wrong password');
  assert.deepEqual(result, { ok: false, reason: 'invalid_credentials' });
  assert.equal(audit.recent(1)[0]?.detail.reason, 'bad_password');
});

test('login rejects an unknown user', async () => {
  const { auth } = await demoApp();
  const result = await auth.login('nobody@example.com', DEMO_PASSWORD);
  assert.deepEqual(result, { ok: false, reason: 'invalid_credentials' });
});

test('a session token validates to its user until logout', async () => {
  const { auth } = await demoApp();
  const result = await auth.login('ADA@example.com ', DEMO_PASSWORD);
  assert.ok(result.ok);
  assert.equal(auth.validate(result.token)?.email, 'ada@example.com');
  assert.equal(auth.logout(result.token), true);
  assert.equal(auth.validate(result.token), null);
});
