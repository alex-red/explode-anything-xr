# ADR-0005: Contracts — Zod 4 as the single source of truth

**Status:** Accepted, 2026-10-23

## Context

The same shapes are needed in four places: build-time validation, the client's runtime validator, the proxy's server-side check, and the LLM's structured-output schema.

## Decision

- `packages/contracts` (Zod 4.6.7) defines every schema.
- `z.toJSONSchema()` produces the LLM schema through `tutorPlanJsonSchema()`.
- `canonicalJson()` provides deterministic hashing.
- `checkBundleIntegrity()` checks references and the truth contract.
- Packages export TypeScript source, using erasable syntax only, for Vite and Node 24 type stripping.

## Consequences

- One edit updates every consumer.
- No codegen step.
- The trade-off: no enums or namespaces anywhere.

## Revisit trigger

A Unity fallback (generate C# types from the JSON Schema).
