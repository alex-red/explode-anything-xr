# EXPLODE docs

These docs supersede `../EXPLODE_VR_Project_Handoff_2026.md` (v1.0, kept for history) for scope, architecture and schedule.

| Doc | What it's for |
|---|---|
| [REVIEW.md](REVIEW.md) | Review of the original handoff: corrections, gaps, cuts, open **VERIFY** items, traceability |
| [PRODUCT_SPEC.md](PRODUCT_SPEC.md) | Pitch, defining loop, users, prior art, award strategy, P0/P1/P2 scope, honesty rules |
| [INTERACTION_SPEC.md](INTERACTION_SPEC.md) | First five minutes, gestures, visual language, panels, tutor persona, accessibility |
| [ARCHITECTURE.md](ARCHITECTURE.md) | System diagram, repo layout, truth contract, contracts, engine, allowlist, content pipeline, tutor, threat model |
| [PLAN.md](PLAN.md) | Day-by-day schedule, gates and kill-switches, agent/human split, risk register, budget, work packages |
| [QA_MATRIX.md](QA_MATRIX.md) | Acceptance tests AT-01…AT-14, automated suites, device checklist, playtest protocol |
| [SUBMISSION_CHECKLIST.md](SUBMISSION_CHECKLIST.md) | Eligibility, PWA packaging, freeze, Devpost entry, final verification |
| [DATA_PROVENANCE.md](DATA_PROVENANCE.md) | Licenses and sources for everything shipped, plus prior-art links |
| [VIDEO_STORYBOARD.md](VIDEO_STORYBOARD.md) | Demo video beats and capture notes |

## Architecture decision records

| ADR | Decision |
|---|---|
| [0001](adr/0001-engine.md) | Engine: IWSDK 1.0.1 WebXR PWA (Unity fallback) |
| [0002](adr/0002-distribution.md) | Distribution: Bubblewrap TWA + immutable static deploy |
| [0003](adr/0003-session-passthrough.md) | Session: immersive AR, passthrough-first, seated |
| [0004](adr/0004-backend.md) | Backend: none, except an optional tutor proxy Worker |
| [0005](adr/0005-contracts.md) | Contracts: Zod 4 single source of truth |
| [0006](adr/0006-indexer.md) | Indexer: ts-morph, build-time, conservative |
| [0007](adr/0007-evidence.md) | Evidence: typed records; observed = recorded at build time |
| [0008](adr/0008-versioning.md) | Versioning: git revision vs content hash |
| [0009](adr/0009-lesson-engine.md) | Lesson engine: pure reducer over an event log |
| [0010](adr/0010-propagation.md) | Propagation: typed-flow paths |
| [0011](adr/0011-tutor.md) | Tutor: one structured call per turn, scripted by default |
| [0012](adr/0012-input.md) | Input: ray + select, two-hand pull, a button for everything |
| [0013](adr/0013-render-budget.md) | Render budget: sustained 72 Hz, no post-processing |
| [0014](adr/0014-layout-cone.md) | Layout: 60°×50° cone, ≤0.65 m reach |
| [0015](adr/0015-audio.md) | Audio: Web Audio, pre-rendered narration, captions |
| [0016](adr/0016-offline.md) | Offline and persistence: precache + localStorage event log |
| [0017](adr/0017-platform.md) | Platform: Quest 3/3S only |
| [0018](adr/0018-fixture-repo.md) | Hero repo: sample auth-service written for this demo |
| [0019](adr/0019-assets.md) | Assets: procedural only |
| [0020](adr/0020-testing.md) | Testing: Vitest, IWER end-to-end, device checklist |
