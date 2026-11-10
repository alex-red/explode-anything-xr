# ADR-0011: Tutor — one structured call per turn, scripted by default

**Status:** Accepted, 2026-10-23

## Context

- The handoff's agent loop made one LLM round-trip per action.
- It also used RAG over a graph small enough to fit in context.
- Voice is unavailable in Quest Browser (REPORTED), so there is no free-text input in XR.

## Decision

- Turns are triggered by context chips (`explain_selection`, `what_depends`, `why_failed`, `hint`; `free_text` is P2).
- The client sends a `TutorTurnRequest` to the proxy, which makes **one** Messages API call:
  - default model `claude-haiku-5-5`;
  - structured output against `tutorPlanJsonSchema()`;
  - the whole graph in the prompt;
  - repo text treated as untrusted data.
- It returns a `TutorPlan`: `say`, `claim_status`, `evidence_ids`, ≤4 `actions`, `abstain`.
- The client **re-validates** with `validateTutorPlan`, which rejects any unknown id, any action outside `TUTOR_ACTION_TYPES`, or any claim stronger than its evidence.
- The client falls back to `scriptedTutorTurn` after **6 s**, on any invalid plan, or when offline.
- The scripted tutor is the default until K6.

## Consequences

- At most one round-trip per turn.
- The tutor can only *show*. It cannot break, repair, reset, grade or advance.

## Revisit trigger

Voice input ships (P2), which adds `free_text`.
