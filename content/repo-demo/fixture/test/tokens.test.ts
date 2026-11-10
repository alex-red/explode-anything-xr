import assert from 'node:assert/strict';
import { test } from 'node:test';
import { signToken, verifyToken } from '../src/auth/tokens.ts';
import { SessionStore } from '../src/sessions/store.ts';

test('a signed token verifies and a tampered one does not', () => {
  const token = signToken('session-1', 'secret');
  assert.equal(verifyToken(token, 'secret'), 'session-1');
  assert.equal(verifyToken(token.replace('session-1', 'session-2'), 'secret'), null);
  assert.equal(verifyToken(token, 'other-secret'), null);
});

test('sessions expire after their time to live', () => {
  const store = new SessionStore('secret', 1000);
  const session = store.create('user-1', 0);
  assert.equal(store.findByToken(session.token, 500)?.userId, 'user-1');
  assert.equal(store.findByToken(session.token, 1000), null);
});
