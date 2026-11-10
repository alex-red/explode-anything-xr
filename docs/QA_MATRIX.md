# EXPLODE — QA Matrix

**Supersedes:** handoff §16, §17 · Run the device checklist (§3) on **every uploaded build**.

---

## 1. Acceptance tests

| ID | Test | Pass condition | How |
|---|---|---|---|
| AT-01 | Store cold start | A second account installs from the invite and reaches an interactive object in ≤15 s on Wi-Fi, hands only | Device |
| AT-02 | Offline | After one online launch, airplane mode still runs the tutorial and hero lesson. A first launch with no network shows the designed screen, not a browser error | Device |
| AT-03 | Novice run | 3/3 cold novices finish tutorial + hero without coaching in ≤8 min; first explode ≤60 s | Playtest #3 |
| AT-04 | Performance | OVR Metrics: sustained 72 fps, ≤1% dropped frames for 2 min in the worst scene (all exploded, flow on, evidence open, recording) | Device |
| AT-05 | Pause/resume | Meta button mid-break, or headset off for 2 min → resumes at the same step. Killed session → restores or resets cleanly | Device |
| AT-06 | Determinism | `replay(events)` reproduces SceneState exactly; 20 explode/collapse and 20 break/repair cycles show no drift; undo drops only the last undoable event | Unit |
| AT-07 | Truth | Every relation resolves to the pinned revision. `observed` appears only with a recorded run; edges are never observed; unrecorded breaks are `inferred` (hypothesis styling) | Unit + `content:check` + visual |
| AT-08 | Tutor safety | 100% of fuzzed or invalid plans rejected; no tutor action can break, repair or advance; an injected repo comment is ignored; proxy failure → scripted within 6 s | Unit + device |
| AT-09 | Proxy limits | Rate limit and daily cap enforced; `KILL_SWITCH` returns a scripted-fallback signal | Unit + load script |
| AT-10 | Gestures | Explode works in ≥9 of 10 novice attempts; no accidental explode or system menu in 5 min of free use | Playtest |
| AT-11 | Reach and field of view | Layout check: every placement inside the 60°×50° cone at the anchor distance; on device at two seated heights, every target within ~0.65 m | Unit + device |
| AT-12 | Readability | 3 testers read labels and code excerpts seated (on a 3S if available) | Playtest |
| AT-13 | Freeze | Deployed bundle hash = submitted hash, checked daily until Dec 11 | Script |
| AT-14 | Video | Public, under 3 min, genuine on-device footage | Manual |

## 2. Automated suites

| Suite | Location | Covers |
|---|---|---|
| Contracts | via `packages/lesson-engine/test` and `tools/content/test` | Schema parsing of real and fixture bundles; `checkBundleIntegrity` (missing refs, observed edges, truth promotion) |
| Engine | `packages/lesson-engine/test` | Reducer transitions, propagation and truth, predict scoring and misconception, misplug feedback, undo/replay determinism (AT-06), plan validation and fuzz (AT-08), scripted tutor citing only existing ids |
| Indexer | `tools/indexer/test` | Deterministic ids, stable output across runs, file:line ranges match the source, no calls fabricated as verified |
| Content | `tools/content/test` | Both bundles parse; `checkBundleIntegrity` is empty; cone check (AT-11); mutation evidence matches lesson break edges |
| Proxy | `services/tutor-proxy/test` | Validation, rate limit, cap, kill switch, upstream timeout/invalid → error signal (AT-08/09) |
| App logic | `apps/quest/test/app-logic.test.ts` | Event-sourced store: persistence and restore after a killed session (AT-05), per-system logs, undo, throwing storage; tutor client: live, invalid → scripted, network/HTTP errors, Live AI toggle |
| Scene harness | `apps/quest/test/scene-harness.test.ts` | The real app, view, UI and two-hand-pull code against a stub World and a recording canvas: both lessons completed by in-world presses, the consequence hidden until prediction, honest truth badges, evidence panel text, two-hand pull preview and commit, layout within the 60°×50° cone and reach (AT-11), ≤30 labels, no clipped text, pause on blur, disposal when switching systems. **Not covered:** WebGL rendering, real hand tracking, frame rate (device only) |
| End-to-end (P1) | Playwright + IWER | The scripted lesson from launch to complete in the emulator |

Run: `npm test`, `npm run typecheck`, `npm run content:check`.

## 3. Device checklist (every upload)

- [ ] Cold launch → AR auto-enter → object visible, hands only
- [ ] Hand ray hover and select on nodes and buttons; controller ray also works
- [ ] Two-hand pull explodes; button explodes; collapse works
- [ ] Trace lights the path; flow animates
- [ ] Unplug → downstream dims; badge matches truth (Observed / Hypothesis / Teaching model)
- [ ] Wrong socket rejected with feedback; right socket restores
- [ ] Evidence panel readable at seated distance
- [ ] Undo and Reset
- [ ] Meta button → resume at the same step
- [ ] Airplane mode relaunch works
- [ ] OVR Metrics shows 72 fps in the worst scene
- [ ] No system menu triggered during the lesson
- [ ] Left hand dominant pass; two seated heights; glasses wearer

**Trust checks** (handoff §16, kept):

- [ ] Ask about a nonexistent symbol → the tutor abstains
- [ ] A break with no recorded mutation → hypothesis styling
- [ ] An injected comment in the fixture is ignored
- [ ] Proxy unreachable → scripted answer in ≤6 s

## 4. Playtest protocol

**Schedule:**

| Playtest | Date | Who |
|---|---|---|
| #1 | Sun Nov 1 | You + 1 person |
| #2 | Sun Nov 8 | 2 novices (1 developer) |
| #3 | Sat Nov 14 | 3 cold novices |

**Script:**

- Hand over the headset with "Explore this; think aloud." No coaching. Record passthrough capture plus audio.
- Before and after, ask 2 causal questions, e.g. "If X disconnects, what fails first?"

**Measure:**

| Metric | Target |
|---|---|
| Time to first explode | ≤60 s |
| Time to first trace | — |
| Time to first completed repair | — |
| Total time | ≤8 min |

Also record: help requests, misplugs, accidental gestures, comfort issues, readability complaints, and pre/post answers (correct/incorrect).

**Output:** a top-5 issue list, fixed before the next gate. Findings are anecdotal and never marketed as evidence of learning.
