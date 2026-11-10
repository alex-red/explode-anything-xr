# ADR-0020: Testing — Vitest for pure code, IWER for end-to-end, a device checklist per upload

**Status:** Accepted, 2026-10-23

## Context

- Only the developer can test feel and performance on device.
- Logic must be verified without a headset.

## Decision

- **Vitest 4.1.12** over `packages/*`, `tools/*` and `services/*` (`npm test`).
- `tsc --noEmit` (`npm run typecheck`).
- `npm run content:check` validates the bundles.
- P1: Playwright + IWER (via the IWSDK CLI) for a scripted lesson run.
- The [QA_MATRIX.md](../QA_MATRIX.md) device checklist runs on every uploaded build.

## Consequences

Fast feedback, with the human focused on device QA.

## Revisit trigger

The end-to-end run proves too flaky to be worth maintaining.
