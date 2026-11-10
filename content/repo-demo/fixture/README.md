# auth-service (EXPLODE sample)

A small TypeScript authentication service **written for the EXPLODE demo**. It is
not a third-party project and not production code. EXPLODE indexes this source
at build time, runs its tests, and records a few deliberate mutations so the
headset can show which failures were actually observed.

- Login flow: `POST /login` → router → `rateLimit` → `parseJsonBody` →
  `loginHandler` → `AuthService.login` → `UserRepository.findByEmail` →
  `verifyPassword` → `SessionStore.create` → `signToken`.
- Only Node built-ins (scrypt password hashing, HMAC-signed tokens,
  in-memory stores). No dependencies.
- Run the tests with Node 24+: `npm test` (or `node --test test/*.test.ts`).

Do not edit this fixture without regenerating content (`npm run content:generate`
at the repo root); evidence line ranges and recorded runs depend on it.
