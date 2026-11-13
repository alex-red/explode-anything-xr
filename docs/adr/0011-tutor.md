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

## Note, 2026-11-11

The model call can go to Meta's Model API instead of the Messages API (ADR-0004 note), with the same structured plan and the same validation. A live answer now names the model it came from in the caption (`Tutor (live AI · <model>)`), using the model the proxy returned, never a fixed string.

## Note, 2026-11-12: the assistant may act when asked

Decided by the owner on Nov 12: a question in the learner's own words (`free_text`) may also *do* things, not only show them. This replaces "the tutor can only show" for that one trigger.

- A plan gains `commands` (`AssistantCommand`, at most 4): press any visible button by id, select, set the explode amount, trace, unplug, plug, predict, open or close evidence, set the detail level, open another system.
- The request carries a `view` (what is on screen, every button with its current label and enabled state, the systems) and up to 6 lines of `history`.
- Commands are offered to the model, and accepted by `validateTutorPlan`, only on a `free_text` turn that sent a `view`. On every chip turn the field is absent from the output schema and any command rejects the plan.
- Each command runs through the same handler as the hand or button it stands for. The lesson engine still decides, alone, whether a step is passed: the assistant cannot mark anything passed, it can only do what the learner could do.
- The truth contract is unchanged: `say` still carries a claim status no stronger than its evidence, and `view` is never evidence.
- Offline or without the proxy, a `free_text` turn abstains; nothing acts.

Built so far: typed questions on the 2D page. Voice input, spoken answers and the in-world icon are not built.

## Revisit trigger

Voice input ships (P2), which adds `free_text`.
