# Review of `EXPLODE_VR_Project_Handoff_2026.md` (v1.0)

**Reviewed:** October 23–24, 2026 · **Outcome:** the handoff remains the source of the product thesis, but this `docs/` tree supersedes it for scope, architecture, and schedule.

The handoff is a strong product document. Its main problem is that it is planned for the wrong team: a 2–3 person Unity team with a headset and a Python backend. The actual situation is:

- **one developer**, strong in TypeScript and the web, new to Unity and XR;
- **macOS only**;
- **no headset yet**.

The handoff also predates Connect 2026: the VR Glasses announcement and the v207 SDKs. This review lists:

- what to keep;
- factual corrections;
- internal inconsistencies;
- gaps;
- cuts;
- claims that still need outside verification.

Status tags used below:

- **VERIFIED**: confirmed against a linked source on Oct 23, 2026.
- **REPORTED**: secondary source or forum report. Verify on device before relying on it.
- **VERIFY**: could not be confirmed. Action needed.

---

## 1. Keep: the doc's real strengths

| Strength | Where it now lives |
|---|---|
| The truth contract (`observed` / `static_verified` / `authored_model` / `inferred` / `unknown`) and the rule that nothing is silently promoted. This is the product's moat. | [ARCHITECTURE.md §3](ARCHITECTURE.md#3-truth-contract) |
| The SceneAction allowlist and its "never allow" list | [ARCHITECTURE.md §6](ARCHITECTURE.md#6-sceneaction-allowlist) |
| TRACE → BREAK → REPAIR → UNDERSTAND as the single signature loop | [PRODUCT_SPEC.md §2](PRODUCT_SPEC.md#2-the-defining-loop) |
| Kill-switches, the scope-freeze rule, the "Not in MVP" list | [PLAN.md](PLAN.md), [PRODUCT_SPEC.md §6](PRODUCT_SPEC.md#6-scope) |
| Honesty guardrails: no photo-to-internals claims, no silent edits to the repo | [PRODUCT_SPEC.md §7](PRODUCT_SPEC.md#7-honesty-rules) |
| Trust tests; the prior-art table and its rule against claiming "first ever" | [QA_MATRIX.md](QA_MATRIX.md), [PRODUCT_SPEC.md §4](PRODUCT_SPEC.md#4-prior-art-and-differentiation) |

## 2. Factual corrections

| # | Handoff says | Correction | Status |
|---|---|---|---|
| 1 | Target is Quest 3/3S only (§4, §13) | The competition accepts **Meta Quest, Meta VR Glasses, or both**. The VR Glasses ship in spring 2027 and run the same OS, Store, and SDKs as Quest. Their main inputs are **eyes and hands**. Their field of view is about **70×66°**, versus about 110×96° on Quest 3. **Decision:** submit for Quest only, and keep the layout inside a 60°×50° cone so it also works on the Glasses ([ADR-0014](adr/0014-layout-cone.md), [ADR-0017](adr/0017-platform.md)). | VERIFIED [1][2][3] |
| 2 | Distant selection uses "head-gaze + pinch" (§6.2, §13) | On Quest the standard is **hand ray plus the system pinch** (WebXR `select`). Meta treats head gaze as the *last* fallback. Eye gaze plus pinch is the main input on the VR Glasses. ISDK and IWSDK v207 switch between gaze and ray depending on the device. | VERIFIED [3][4] |
| 3 | "Eye tracking: not in MVP; Quest 3/3S lack it" | Correct for Quest 3/3S. As a platform statement it is now out of date. Eye tracking moves to P2, tied to the Glasses profile. | VERIFIED [3][4] |
| 4 | "Minimum 60 FPS" (§4, §16) | Quest Browser runs at **72 Hz**. WebXR has **no Application SpaceWarp**, so every missed frame shows as visible judder. **Target: a sustained 72 fps**, with GPU headroom. | REPORTED: verify the browser's default rate on device |
| 5 | "Open palms apart" pose gesture (§6.2) | Pose detection is fragile. Replace it with a **two-hand grab-and-pull**: the distance between the hands maps to an explode factor from 0 to 1, and an **Explode button** does the same thing. IWSDK's `TwoHandsGrabbable` only translates, rotates, and scales, so a small custom system is needed. Drop the pinch "dwell" threshold. Use about 100 ms of release hysteresis instead. | REPORTED [5]: verify on Day 2 |
| 6 | GitNexus link `nxpatterns/gitnexus` | That repo is a fork. The canonical project is `abhigyanpatwari/GitNexus`. Its license is unverified and may be noncommercial. **Decision:** reference it as prior art only, not as a dependency. | VERIFIED (canonical repo), VERIFY (license) [6] |
| 7 | Prize list | Missing: **Judge's Choice ($20k ×2)** and **Best Social & Multiplayer ($25k)**. The Productivity runner-up gets **$35k**. There is also an **Adapted/Significantly Updated** division. The total is $1M across 20 prizes. | VERIFIED [2] |
| 8 | "Upload a native APK" | Meta's competition post lists **web** as an allowed engine. A PWA is packaged as a thin APK wrapper and can be submitted to the Store. **Whether Devpost accepts a PWA entry is still unconfirmed.** The rules pages returned 403 to automated fetches. | **VERIFY by hand on Day 1** [1][7] |
| 9 | 2026 tooling not mentioned | Missing from the handoff: the Meta VR CLI (`metavr init`, an MCP server that also sets up Claude Code), `meta-quest/agentic-tools` (32 Apache-2.0 skills), IWSDK agent tooling and the IWER emulator, the Meta Asset Library (1.5M assets), and the VR Glasses profile in XR Simulator v207. | VERIFIED [3][8] |
| 10 | Bloom and a "luminous" glow look (§6.3) | Post-processing is expensive on Quest, and in AR it can break the alpha blending of passthrough. Fake glow with emissive and additive materials, and test the result over passthrough on Day 3. | REPORTED: verify in the Oct 26 performance spike |
| 11 | "Dark navy observatory" environment | Replaced by **passthrough-first MR** with a backdrop toggle. It is cheaper to build, more comfortable seated, and a better fit for the Productivity track ([ADR-0003](adr/0003-session-passthrough.md)). | Decision |
| 12 | Voice and TTS assumed available | Forum reports say `speechSynthesis` and `SpeechRecognition` are **missing in Quest Browser**. **Decision:** pre-render narration at build time. Voice moves to P2 (record audio, send it to the proxy for speech-to-text). | REPORTED [9][10]: run a 15-minute spike on Oct 26 |

## 3. Internal inconsistencies

1. **Pitch vs scope.** §1 says "a user points at a car picture", but photo input is P2 (§7). The pitch is rewritten around *picking up a system* ([PRODUCT_SPEC.md §1](PRODUCT_SPEC.md#1-pitch)).
2. **Where the simulator runs.** §8.6 puts `/v1/experiments` on the backend, but §11.5 requires offline play and SIM-01 describes a "Unity bridge". **Resolution:** the simulator is a pure reducer that runs on the client ([ADR-0009](adr/0009-lesson-engine.md)).
3. **Team-shaped schedule.** The owner columns (Art/XR/Backend/AI/QA) and overlapping phases assume several people. One person cannot run "Oct 25–28 XR" and "Oct 27–31 Backend" at the same time. **Resolution:** [PLAN.md](PLAN.md) splits work by human (on-device) vs. background agents (headless TypeScript).
4. **Evidence typing.** Evidence is a string (`"src/...#L8-L42"`) in the graph but an ID in SceneAction and `/v1/evidence/{id}`. **Resolution:** Evidence becomes a first-class typed object ([ADR-0007](adr/0007-evidence.md)).
5. **Mechanical `graph_revision`.** It uses a git hash, but authored content has no git history. **Resolution:** use a content hash ([ADR-0008](adr/0008-versioning.md)).
6. **The LLM decides pass/fail.** `assess_user_action` and `complete_lesson` are LLM actions. That contradicts both "the user does the repair" and determinism. **Resolution:** remove them from the LLM allowlist. Only the lesson engine judges ([ADR-0009](adr/0009-lesson-engine.md), [ADR-0011](adr/0011-tutor.md)).
7. **Agent loop.** "Execute one action at a time; collect feedback" means N LLM round-trips per turn. **Resolution:** one structured call per turn, run by a deterministic executor.
8. **Timing of the invite test.** It is on the Day-1 checklist, but the release dry run sits on Nov 16–17. **Resolution:** first upload and second-account install by **Oct 25** (gate G1).
9. **Retrieval.** RAG is specified for a 20–100-file graph that fits in context whole. **Resolution:** put the whole graph in context. No RAG.

## 4. Gaps

1. **How a PWA is actually distributed.** The APK is a thin wrapper that loads a **live URL**, which has these consequences:
   - (a) Hosting must stay up until about Dec 11.
   - (b) "No updates after the deadline" means deploying to an **immutable versioned path**.
   - (c) Offline play works only after the first launch has installed the service worker.
   - (d) It needs `assetlinks.json` and a **permanent signing key**, backed up. [7]
2. **Dashboard admin.** The Developer Distribution Agreement must be accepted. Meta docs list ALPHA/BETA/RC/STORE channels, so confirm that a channel named **"Competition"** is allowed. Check the privacy policy and Data Use Checkup. Test an invite on a second account. **Do all of this in week 1.**
3. **Hardware and the dev loop on a Mac.**
   - Buy the headset in a store; do not order it online.
   - Serve the dev server over USB with `adb reverse` (localhost counts as a secure context) and debug with `chrome://inspect`.
   - Watch FPS and GPU with the OVR Metrics Tool.
   - Check readability on a **Quest 3S** (lower pixel density).
4. **Missing schemas:** Evidence, Lesson (step state machine), flow and propagation rules, SceneState, Event (event-sourced log), Layout, AssetManifest, NarrationScript. See [ARCHITECTURE.md §4](ARCHITECTURE.md#4-contracts).
5. **Input without voice.** The XR session has no keyboard, so free-form questions largely disappear. The tutor becomes **context-triggered**: chips ("Explain this", "Why did that fail?", "What depends on this?") plus hints after mistakes. It still observes, acts on the scene, and responds to the learner, so it still counts as agentic.
6. **"Observed" evidence created at build time.** This is the biggest upgrade. Run the fixture's tests with coverage, and pre-run 3–5 mutations (stub a dependency, record the failing output). Each result is an Evidence record with commit, command, Node version, timestamp, and output hash. This removes the runtime sandbox entirely. The precise rules:
   - A node is `observed` only if it actually executed during a recorded test run.
   - An edge stays `static_verified` unless a recorded mutation matches it.
   - A user break with no matching recording is styled as a **hypothesis**.
   - The UI says "recorded at build time", never "running now".
7. **Pause, resume, and session loss.** Seated play with clean pause and resume is a judging guideline. Handle `visibilitychange` and the XR session's blur/hidden states. Snapshot to IndexedDB on every lesson step.
8. **Robustness.**
   - Hand tracking may be disabled on a judge's headset: show a "no hands" hint and support the controller ray (almost free in IWSDK).
   - Use a seated reference space and allow recentering.
9. **Asset licensing on the web.** Every asset in a PWA can be downloaded by anyone. Many licenses forbid redistributing the raw files. **Resolution:** build the mechanical tutorial from **procedural primitives** ([ADR-0019](adr/0019-assets.md)).
10. **Protecting the LLM proxy from abuse.** Its URL is effectively public. Add a rate limit, a daily spend cap, and a remote kill flag ([ADR-0004](adr/0004-backend.md)).
11. **Capture plan.** On Day 3, check that recordings include passthrough and that capture resolution can be raised (MQDH, scrcpy, adb). Profile while recording, since recording costs frame time. Tidy the room, because passthrough footage shows it.
12. **Missing project basics:** git repo, CI, budget, risk register, and an agent workflow. IWSDK is young and coding agents know it poorly, so pin versions and doc links in [AGENTS.md](../AGENTS.md).
13. **Playtests come too late.** The only one was on Nov 14–15. **Resolution:** three playtests, on Nov 1, Nov 8, and Nov 14.
14. **WebXR-specific risks the handoff didn't anticipate** (all in the [PLAN.md risk register](PLAN.md#risk-register)):
    - In three.js, every mesh is a draw call, and WebGL lines are always 1 px wide.
    - Code excerpts are the hardest text to read.
    - Virtual content draws over the user's real hands in passthrough.
    - Quest Browser updates can't be pinned during judging.
    - Most of Meta's new agent tooling (XR Operator, Runtime Optimizer) is aimed at Unity or native apps.

## 5. Cut: overbuilt for one person in 26 days

- FastAPI, the 9-endpoint API, and Python in general. Tree-sitter and GitNexus as dependencies.
- The runtime test sandbox. It is replaced by build-time recordings.
- RAG.
- The numeric mastery learner model. Keep a completion flag plus one misconception tag.
- The multi-call agent loop. Bloom. The photo adapter.
- The learning-outcome research study. It stays as roadmap prose in [PRODUCT_SPEC.md §9](PRODUCT_SPEC.md#9-beyond-the-hackathon).

## 6. Still needs outside verification

| Item | How | By |
|---|---|---|
| Devpost accepts PWA/web entries | Read the rules, FAQ, and judging pages by hand; ask on Devpost and the Start Discord; keep the written answer | **Oct 26** (gate K1) |
| A release channel can be named "Competition" | Create it in the Developer Dashboard | Oct 25 (G1) |
| Judging devices (Quest 3 / 3S?), criterion weights, team rules, the 3-minute video rule | Read the Devpost pages by hand | Oct 24 |
| `TwoHandsGrabbable` behavior; whether a hand pinch maps to trigger or squeeze | Device test | Oct 24 (G0) |
| Passthrough appears in recordings; capture resolution can be raised | Device test | Oct 26 |
| Web Speech API is missing in Quest Browser | Device spike | Oct 26 |
| GitNexus license (only needed if it is ever used) | Read its LICENSE file | Optional |
| Fixture repo candidates and licenses | Agent task | Oct 25 |

## 7. Traceability: handoff sections → new docs

| Handoff § | Destination | Notes |
|---|---|---|
| Header, §0 vocabulary | [PRODUCT_SPEC.md §0](PRODUCT_SPEC.md#0-status-vocabulary) | Kept |
| §1 One-page summary | [PRODUCT_SPEC.md §1–2](PRODUCT_SPEC.md#1-pitch) | Pitch rewritten; repo is the hero |
| §2 Problem and opportunity | [PRODUCT_SPEC.md §3](PRODUCT_SPEC.md#3-problem-users-and-jobs) | Kept, condensed |
| §3 Prior art | [PRODUCT_SPEC.md §4](PRODUCT_SPEC.md#4-prior-art-and-differentiation), [DATA_PROVENANCE.md](DATA_PROVENANCE.md) | GitNexus link fixed |
| §4 Rules checklist | [SUBMISSION_CHECKLIST.md](SUBMISSION_CHECKLIST.md), [PRODUCT_SPEC.md §5](PRODUCT_SPEC.md#5-competition-fit-and-award-strategy) | Prizes corrected; VERIFY items added |
| §5 Pillars | [PRODUCT_SPEC.md §2](PRODUCT_SPEC.md#2-the-defining-loop), [INTERACTION_SPEC.md](INTERACTION_SPEC.md) | Pillar E updated for MR |
| §6 Experience spec | [INTERACTION_SPEC.md](INTERACTION_SPEC.md) | Gestures corrected; first 5 min rebuilt |
| §7 Scope | [PRODUCT_SPEC.md §6](PRODUCT_SPEC.md#6-scope) | Re-cut for one person |
| §8 Architecture | [ARCHITECTURE.md](ARCHITECTURE.md), ADRs 0004–0013 | Backend removed; schemas added |
| §9 Repo analyzer | [ARCHITECTURE.md §7](ARCHITECTURE.md#7-build-time-content-pipeline), [ADR-0006](adr/0006-indexer.md), [ADR-0018](adr/0018-fixture-repo.md) | ts-morph only; build-time evidence |
| §10 Mechanical pipeline | [ARCHITECTURE.md §7](ARCHITECTURE.md#7-build-time-content-pipeline), [ADR-0019](adr/0019-assets.md) | Now a procedural tutorial |
| §11 Tutor and pedagogy | [ARCHITECTURE.md §8](ARCHITECTURE.md#8-tutor), [INTERACTION_SPEC.md §6](INTERACTION_SPEC.md#6-tutor-persona-and-teaching-policy) | One call per turn; triggered by context chips |
| §12 Security | [ARCHITECTURE.md §9](ARCHITECTURE.md#9-threat-model-and-controls) | Trimmed to the real threat surface |
| §13 Accessibility | [INTERACTION_SPEC.md §7](INTERACTION_SPEC.md#7-accessibility-and-comfort) | Kept; gaze line corrected |
| §14 Stack and layout | [ARCHITECTURE.md §2](ARCHITECTURE.md#2-repository-layout), ADRs 0001/0005 | IWSDK, all TypeScript |
| §15 Timeline | [PLAN.md](PLAN.md) | Rebuilt around gates G0–G4 |
| §16 Acceptance tests | [QA_MATRIX.md](QA_MATRIX.md) | AT-01…AT-14 replace A01–A13 |
| §17 User research | [QA_MATRIX.md §4](QA_MATRIX.md#4-playtest-protocol), [PRODUCT_SPEC.md §8](PRODUCT_SPEC.md#8-hypotheses-and-invalidation) | Three scheduled playtests |
| §18 Video | [VIDEO_STORYBOARD.md](VIDEO_STORYBOARD.md) | Re-cut |
| §19 Submission | [SUBMISSION_CHECKLIST.md](SUBMISSION_CHECKLIST.md) | PWA items added |
| §20 Open questions | Resolved in ADRs; leftovers in §6 above | — |
| §21 Work packages | [PLAN.md § Work packages](PLAN.md#work-packages) | Re-cut for one person plus agents |
| §22 Agent instructions | [AGENTS.md](../AGENTS.md) | Rewritten |
| §23 Roadmap and research | [PRODUCT_SPEC.md §9](PRODUCT_SPEC.md#9-beyond-the-hackathon) | Kept as prose |
| §24 Sources | Sources below, [DATA_PROVENANCE.md](DATA_PROVENANCE.md) | Updated |
| §25 Final directive | [PRODUCT_SPEC.md §1](PRODUCT_SPEC.md#1-pitch) | Kept in spirit |

## Sources

1. [Meta: Meta VR Start Developer Competition — Reach Further, Win Bigger](https://developers.meta.com/blog/meta-connect-2026-vr-start-developer-competition/)
2. [UploadVR: Meta launches $1 million competition for hands-first apps ahead of VR Glasses](https://www.uploadvr.com/meta-launches-1-million-competition-for-hands-first-apps-ahead-of-vr-glasses/)
3. [Meta: Connect recap — start building the future of VR](https://developers.meta.com/blog/meta-connect-recap-start-building-the-future-of-vr/)
4. [Meta: Horizon OS input](https://developers.meta.com/vr/essentials/horizon-os-input/) · [Getting started with hands and eyes](https://developers.meta.com/vr/essentials/getting-started-with-hands-and-eyes/) · [Eyes design](https://developers.meta.com/vr/design/eyes/)
5. [IWSDK grabbing concepts](https://developers.meta.com/horizon/documentation/iwsdk/concepts/grabbing/) · [Interaction types](https://developers.meta.com/horizon/documentation/iwsdk/concepts/grabbing/interaction-types/) · [Built-in interactions guide](https://iwsdk.dev/guides/06-built-in-interactions.html)
6. [GitNexus (canonical)](https://github.com/abhigyanpatwari/GitNexus)
7. [Meta: PWA packaging](https://developers.meta.com/vr/documentation/web/pwa-packaging/)
8. [Meta: AI tools for VR developers](https://developers.meta.com/vr/discover/ai-tools/) · [Meta VR CLI](https://developers.meta.com/vr/downloads/package/meta-vr-cli/) · [Meta XR Operator](https://developers.meta.com/vr/documentation/unity/meta-xr-operator/getting-started/)
9. [Meta forum: SpeechRecognition in WebXR](https://communityforums.atmeta.com/discussions/dev-quest/speechrecognition-in-webxr/1168273)
10. [Meta forum: speechSynthesis is not defined in Oculus Browser](https://communityforums.atmeta.com/discussions/dev-general/%E2%80%9Cspeechsynthesis-is-not-defined%E2%80%9D-uncaught-referenceerror-in-oculus-browser/797880)
11. [Meta XR Interaction SDK downloads (v207)](https://developers.meta.com/vr/downloads/package/meta-xr-interaction-sdk/)
