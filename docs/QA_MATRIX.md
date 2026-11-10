# EXPLODE — QA Matrix

**Supersedes:** handoff §16, §17 · Run the device checklist (§3) on **every deploy you intend to keep**. Updated 2026-11-09 for link-based submission ([FINAL_PLAN.md](FINAL_PLAN.md)).

> **Emulator-only plan (Nov 9):** no headset is being bought. Rows marked *Device* below can be run only by a borrowed tester with a Quest ([FINAL_PLAN.md §10](FINAL_PLAN.md#10-how-things-are-verified-now)). Until one does, they are **unknown**, not passing. The emulator walkthrough covers the logic of AT-01, AT-05 and AT-10.

---

## 1. Acceptance tests

| ID | Test | Pass condition | How |
|---|---|---|---|
| AT-01 | Cold start from the link | A fresh Quest Browser profile opens the production URL, and one press on the landing page reaches an interactive object in passthrough in ≤15 s on Wi-Fi, hands only | Device |
| AT-02 | Network loss (offline relaunch is P1) | With Wi-Fi turned off after the page has loaded, both lessons still complete with the scripted tutor. Relaunching offline is not required | Device |
| AT-03 | Novice run | Every cold novice finishes tutorial + hero without coaching in ≤8 min; first explode ≤60 s | Playtest #2 |
| AT-04 | Performance | OVR Metrics: sustained 72 fps, ≤1% dropped frames for 2 min in the worst scene (all exploded, flow on, evidence open, recording) | Device |
| AT-05 | Pause/resume | Meta button mid-break, or headset off for 2 min → resumes at the same step. Killed session → restores or resets cleanly | Device |
| AT-06 | Determinism | `replay(events)` reproduces SceneState exactly; 20 explode/collapse and 20 break/repair cycles show no drift; undo drops only the last undoable event | Unit |
| AT-07 | Truth | Every relation resolves to the pinned revision. `observed` appears only with a recorded run; edges are never observed; unrecorded breaks are `inferred` (hypothesis styling) | Unit + `content:check` + visual |
| AT-08 | Tutor safety | 100% of fuzzed or invalid plans rejected; no tutor action can break, repair or advance; an injected repo comment is ignored; proxy failure → scripted within 6 s | Unit + device |
| AT-09 | Proxy limits | Rate limit and daily cap enforced; `KILL_SWITCH` returns a scripted-fallback signal | Unit + load script |
| AT-10 | Gestures | Explode works in ≥9 of 10 novice attempts; no accidental explode or system menu in 5 min of free use; the first pinch of a two-hand pull never selects, presses or predicts | Unit + playtest |
| AT-11 | Reach and field of view | Layout check: every placement inside the 60°×50° cone at the anchor distance; on device at two seated heights, every target within ~0.65 m | Unit + device |
| AT-12 | Readability | 3 testers read labels and code excerpts seated (on a 3S if available) | Playtest |
| AT-13 | Freeze | `npm run release:verify <production url>` reports every deployed file identical to `release/manifest.json`; run before submitting and weekly until winners are announced | Script |
| AT-14 | Video | Public, under the length limit, genuine capture of the real app; emulator footage labeled as such | Manual |

## 2. Automated suites

| Suite | Location | Covers |
|---|---|---|
| Contracts | via `packages/lesson-engine/test` and `tools/content/test` | Schema parsing of real and fixture bundles; `checkBundleIntegrity` (missing refs, observed edges, truth promotion) |
| Engine | `packages/lesson-engine/test` | Reducer transitions, propagation and truth, predict scoring and misconception, misplug feedback, undo/replay determinism (AT-06), plan validation and fuzz (AT-08), scripted tutor citing only existing ids |
| Indexer | `tools/indexer/test` | Deterministic ids, stable output across runs, file:line ranges match the source, no calls fabricated as verified |
| Content | `tools/content/test` | Both bundles parse; `checkBundleIntegrity` is empty; cone check (AT-11); mutation evidence matches lesson break edges |
| Proxy | `services/tutor-proxy/test` | Validation, rate limit, cap, kill switch, upstream timeout/invalid → error signal (AT-08/09) |
| App logic | `apps/quest/test/app-logic.test.ts` | Event-sourced store: persistence and restore after a killed session (AT-05), per-system logs, undo, throwing storage; tutor client: live, invalid → scripted, network/HTTP errors, Live AI toggle |
| Scene harness | `apps/quest/test/scene-harness.test.ts` | The real app, view, UI and two-hand-pull code against a stub World and a recording canvas: both lessons completed by in-world presses, presses delivered on pinch release and dropped by a two-hand pull, the no-hands hint, the debug readout, the consequence hidden until prediction, honest truth badges, evidence panel text, two-hand pull preview and commit, layout within the 60°×50° cone and reach (AT-11), ≤30 labels, no clipped text, pause on blur, disposal when switching systems. **Not covered:** WebGL rendering, real hand tracking, frame rate (device only) |
| Emulator walkthrough | `npm run emulator:walkthrough` (needs the dev server; `-- --start` runs one headless) | The real app in the IWER emulator: session start, both lessons by emulated ray in controller and hand mode, wrong socket rejected, two-hand pull with no stray selection, no console warnings or errors. **Not covered:** frame rate, readability, real hand tracking |
| Release | `tools/release/test` | File hashing including dot-directories; changed, missing and unreachable files reported; site root checked against `index.html` (AT-13) |

Run: `npm test`, `npm run typecheck`, `npm run content:check`.

## 3. Device checklist (every deploy you intend to keep)

- [ ] Open the link in Quest Browser → landing page → one press → passthrough AR → object visible, hands only
- [ ] A single pinch-and-release on a part or button feels immediate
- [ ] Starting a two-hand pull while pointing at parts or buttons triggers nothing
- [ ] Hands dropped out of view → the "can't see your hands" hint appears, and clears when they return
- [ ] After a redeploy to the dev URL, a reload shows the new build
- [ ] Hand ray hover and select on nodes and buttons; controller ray also works
- [ ] Two-hand pull explodes; button explodes; collapse works
- [ ] Trace lights the path; flow animates
- [ ] Unplug → downstream dims; badge matches truth (Observed / Hypothesis / Teaching model)
- [ ] Wrong socket rejected with feedback; right socket restores
- [ ] Evidence panel readable at seated distance
- [ ] Undo and Reset
- [ ] Meta button → resume at the same step
- [ ] Wi-Fi off after load: the lesson still completes
- [ ] OVR Metrics shows 72 fps in the worst scene (`?debug` shows draw calls and slow frames)
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
| #1 | Fri Nov 13 | 1–2 people |
| #2 | Sun Nov 15 | 2–3 cold novices (1 developer if possible) |

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
