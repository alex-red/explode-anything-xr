# ADR-0018: Hero repo — a sample auth-service written for this demo

**Status:** Accepted, 2026-10-23 (amended 2026-10-24)

## Context

The hero lesson needs all of the following:

- a TypeScript login flow;
- tests that run in under 30 s with no external DB;
- a license that allows redistribution;
- deliberately linked "break this edge → these tests fail" semantics.

Vetting a third-party repo costs time and adds licensing and routing-adapter risk.

## Decision

- P0 uses **`content/repo-demo/fixture`**, a small TypeScript `auth-service` (routes → handlers → services → stores) written for this demo and MIT-licensed.
- It is real code with real `node:test` tests that run under Node 24 type stripping, and it is genuinely indexed and test-recorded.
- **The UI and Devpost text disclose it as "a sample service written for this demo."**
- The fixture's git revision is pinned in the bundle.

## Consequences

- Full control and honest semantics.
- Less impressive than a well-known repo.

## Revisit trigger

P1, optional: swap in a third-party MIT/Apache repo with 20–80 TypeScript files, a login flow, and fast DB-free tests, under the same pipeline and disclosure.
