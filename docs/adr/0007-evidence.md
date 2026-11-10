# ADR-0007: Evidence — typed records; "observed" means recorded at build time

**Status:** Accepted, 2026-10-23

## Context

- The handoff wanted `observed` failures, which would need a hardened runtime sandbox.
- It also typed evidence inconsistently (strings in some places, ids in others).

## Decision

`Evidence` is a discriminated union: `source_range`, `test_run`, `mutation_run`, `authored_rule`, `asset_license`. Each record has a deterministic id.

At build time, `tools/content` runs:

- **Baseline:** `node --test` on the fixture with `NODE_V8_COVERAGE`. This produces one `test_run` record whose `executed_node_ids` are the function nodes that actually executed. Only those nodes may be `observed`.
- **Mutations:** 2–3 specs. Each stubs one dependency in a temp copy, reruns the tests, and records the failures as `mutation_run`, keyed by `mutation.edge_id`.

Rules:

- Edges are **never** `observed`.
- A break consequence is `observed` only when a matching mutation run has `failed > 0`. Otherwise it is `inferred`.
- The UI says "recorded at build time".

## Consequences

- No code runs at runtime.
- Evidence is reproducible and hashed.
- Only pre-recorded breaks can show `observed`.

## Revisit trigger

Live OpenTelemetry traces (post-hackathon) as a runtime source for edges.
