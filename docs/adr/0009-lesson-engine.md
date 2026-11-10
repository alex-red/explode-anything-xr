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
