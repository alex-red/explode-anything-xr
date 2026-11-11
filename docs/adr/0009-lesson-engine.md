# ADR-0009: Lesson engine — pure reducer over an event log

**Status:** Accepted, 2026-10-23

## Context

- The handoff placed experiments on a backend.
- It also let the LLM decide pass/fail (`assess_user_action`, `complete_lesson`).

## Decision

`packages/lesson-engine`:

- `reduce(ctx, state, event)` is pure. `replay()` rebuilds state from the log. `undo()` drops the last undoable event (set_explode, select, trace, unplug, plug).
- Lesson steps declare `expect`. **Only the engine** checks it and advances.
- Predictions are scored deterministically against `computeConsequence`.
- A wrong plug increments `misplug_count` and gives feedback; after the second miss it names the expected socket.
- The engine runs on the client.

## Consequences

- Deterministic replay makes pause/resume, undo and testing straightforward (AT-06).
- The LLM can never grade.

## Revisit trigger

None expected.

## Note, 2026-11-11

A lesson may set `starts_broken`: `initialState` then cuts its `break_edge_id` exactly as an `unplug` event would, so reset and replay bring the incident back. Only the lesson engine does this, and `checkBundleIntegrity` requires the edge to exist and be sandbox-mutable. The codebase's incident drill uses it ([WIN_PLAN.md](../WIN_PLAN.md) W9).

