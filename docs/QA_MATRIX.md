# EXPLODE — QA Matrix

**Supersedes:** handoff §16, §17 · Run the device checklist (§3) on **every deploy you intend to keep**. Updated 2026-11-09 for link-based submission ([FINAL_PLAN.md](FINAL_PLAN.md)).

> **Nov 11:** a Quest 3S is on the way; the device protocol is in [WIN_PLAN.md §7](WIN_PLAN.md#7-testing-on-the-quest-3s). Until it is run, every row marked *Device* is **unknown**, not passing. Results go in §5 with the date, headset and OS version; a check that was not run is recorded as not run. The emulator walkthrough covers the logic of AT-01, AT-05 and AT-10; §5 lists what the emulator showed on Nov 11.

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
| AT-13 | Freeze | `bun run release:verify <production url>` reports every deployed file identical to `release/manifest.json`; run before submitting and weekly until winners are announced | Script |
| AT-14 | Video | Public, under the length limit, genuine capture of the real app; emulator footage labeled as such | Manual |
| AT-15 | Desk placement and fallbacks ([ADR-0023](adr/0023-room-anchoring.md)) | Seated at a desk with room setup, the stage stands on the desk and no panel sits below it. With no room setup, permission refused, no suitable table, or a VR session, it floats as before with nothing broken | Unit + harness + device (rooms a–f in WIN_PLAN §7) |
| AT-16 | Desk memory | Quit and return (next day): the stage is back on the same spot, or re-placed cleanly if the anchor is gone. Recenter re-picks; the reset key forgets | Unit + harness + device |
| AT-17 | Dimming break ([ADR-0024](adr/0024-headset-model-and-dimming.md)) | The room dims only after the prediction, with its caption; repair restores it; never on the 2D page or over the virtual backdrop; five break/repair cycles with no flash or discomfort | Harness + device |
| AT-18 | Field-of-view layouts | Wide: model, caption and toolbar within ±46°×±43° of the gaze at the model; narrow: every panel within ±33°×±31°, no two overlapping; on device, nothing essential needs a head turn in wide | Harness + device |
| AT-19 | Sound | Every lesson beat has a sound at its part; nothing plays before the first press; Sound on/quiet/off is remembered; levels are comfortable on the headset's speakers | Unit + harness + device |
| AT-20 | Targets and labels | No two ray targets in the codebase layout overlap; no two visible part labels overlap as seen from the eye | `bundles.test` + harness |

## 2. Automated suites

| Suite | Location | Covers |
|---|---|---|
| Contracts | via `packages/lesson-engine/test` and `tools/content/test` | Schema parsing of real and fixture bundles; `checkBundleIntegrity` (missing refs, observed edges, truth promotion) |
| Engine | `packages/lesson-engine/test` | Reducer transitions, propagation and truth, predict scoring and misconception, misplug feedback, undo/replay determinism (AT-06), plan validation and fuzz (AT-08), scripted tutor citing only existing ids |
| Indexer | `tools/indexer/test` | Deterministic ids, stable output across runs, file:line ranges match the source, no calls fabricated as verified |
| Content | `tools/content/test` | All three bundles (drivetrain, headset, repo) parse; `checkBundleIntegrity` is empty; cone check (AT-11); no overlapping ray targets in the spread software layout (AT-20); mutation evidence matches lesson break edges; the headset's camera link darkens the processor, display and lenses but not the speakers or battery |
| Room and memory | `apps/quest/test/surface-pick.test.ts`, `desk-memory.test.ts` | Desk choice by height, size and reach, rejecting floors, shelves, a standing viewer and desks behind; saving the desk pose against an anchor and recalling it after the anchor has moved and turned; corrupt or mismatched memory ignored; the SDK anchor adapter waits for a settled pose (AT-15/16) |
| Sound | `apps/quest/test/audio.test.ts` | Against a recording fake Web Audio context: no audio before a press, placement at the part, the cascade's voices, levels and mute, the hum's start and stop, the listener following the head (AT-19) |
| Proxy | `services/tutor-proxy/test` | Validation, rate limit, cap, kill switch, upstream timeout/invalid → error signal (AT-08/09) |
| App logic | `apps/quest/test/app-logic.test.ts` | Event-sourced store: persistence and restore after a killed session (AT-05), per-system logs, undo, throwing storage; tutor client: live, invalid → scripted, network/HTTP errors, Live AI toggle |
| Scene harness | `apps/quest/test/scene-harness.test.ts` | The real app, view, UI and hand-gesture code against a stub World and a recording canvas: both lessons completed by in-world presses, presses delivered on pinch release and dropped by a hand gesture or by sliding off the target, moving, zooming and turning the model with the hands and their key equivalents, the no-hands hint, the debug readout, the consequence hidden until prediction, honest truth badges, evidence panel text, two-hand pull preview and commit, layout within the 60°×50° cone and reach (AT-11), ≤30 labels, no clipped text, pause on blur, disposal when switching systems. Since Nov 11 also: the headset opening lesson and "More"; the stage on a desk with panels above it; desk memory across sessions (AT-16); the dimming break and where it never happens (AT-17); both field-of-view layouts, floating and on a desk (AT-18); the sound for every beat (AT-19); no overlapping labels (AT-20); finished lessons remembered; the draw-call budget in the worst software scene and in the opening scene. **Not covered:** WebGL rendering, real hand tracking, frame rate (device only) |
| Emulator walkthrough | `bun run emulator:walkthrough` (needs the dev server; `-- --start` runs one headless) | The real app in the IWER emulator: session start, both lessons by emulated ray in controller and hand mode, wrong socket rejected, two-hand pull with no stray selection, no console warnings or errors. **Not covered:** frame rate, readability, real hand tracking |
| Release | `tools/release/test` | File hashing including dot-directories; changed, missing and unreachable files reported; site root checked against `index.html` (AT-13) |

Run: `bun run test`, `bun run typecheck`, `bun run content:check`.

## 3. Device checklist (every deploy you intend to keep)

- [ ] Open the link in Quest Browser → landing page → one press → passthrough AR → object visible, hands only
- [ ] A single pinch-and-release on a part or button feels immediate
- [ ] Starting a two-hand pull while pointing at parts or buttons triggers nothing
- [ ] Hands dropped out of view → the "can't see your hands" hint appears, and clears when they return
- [ ] After a redeploy to the dev URL, a reload shows the new build
- [ ] Hand ray hover and select on nodes and buttons; controller ray also works
- [ ] Two-hand pull explodes; button explodes; collapse works
- [ ] Pulling past fully exploded zooms in; pushing together zooms out, then collapses
- [ ] One-hand pinch-and-drag from a part moves the model and does not select the part; a quick pinch still selects
- [ ] One-hand pinch-and-drag from empty space turns and tilts the model; the tilt stops before it flips
- [ ] The Gestures button shows the guide card and hides it; the card is readable and blocks nothing
- [ ] Two hands pushed away or pulled closer tilt the model about the horizontal axis; holding still does not
- [ ] Two hands turning like a steering wheel roll the model and it follows the hands; one hand forward and one back spins it; a straight pull does neither
- [ ] After any drag, the next pinch with the same hand registers (IWSDK stuck-pointer work-around)
- [ ] Recenter resets move, zoom, spin, tilt and roll
- [ ] Hologram look: frame rate holds with the halos, stage and beam on; glow composites cleanly over passthrough; scanlines do not shimmer; captions and evidence stay readable over a bright room
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
- [ ] The stage stands on the desk; no panel sits inside or under it; Recenter re-picks (AT-15)
- [ ] With no room setup, and with the permission refused: the stage floats, nothing errors (AT-15)
- [ ] Quit, come back later: the stage is on the same spot (AT-16)
- [ ] Cutting the camera link dims the room only after the prediction; repair restores it; five cycles, no flash (AT-17)
- [ ] Sounds are present, placed and comfortable; Sound quiet and off work (AT-19)
- [ ] Wide layout: nothing essential needs a head turn; narrow layout readable (AT-18)
- [ ] `?debug` + Recenter: copy the `[explode:surfaces]` line into §5 (spike S2)

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

## 5. Results

Each row: date, where it ran, what was checked, the result, and what it does not prove.

| Date | Where | Check | Result | Does not prove |
|---|---|---|---|---|
| 2026-11-11 | IWER, Quest 3 profile, `living_room` | `emulator:walkthrough`, controller and hand mode, after each change that day | Pass: headset and software lessons by ray, wrong socket rejected, two-hand pull, no console warnings or errors (98–112 s) | Frame rate, readability, real hand tracking |
| 2026-11-11 | IWER, `living_room` | Plane detection: 17 planes delivered, including four tables (0.45–0.79 m high) | Seated at eye height 1.2 m in front of the 0.79 m table, the stage stands on it, toolbar above the surface. At the default standing height (1.6 m) no desk is picked, by design | Which labels and sizes a real room setup returns (spike S2) |
| 2026-11-11 | IWER, `living_room` | Desk memory: exit, re-enter standing elsewhere | The stage floats, then returns to the remembered table spot once the anchor is restored | Persistence across real sessions: the emulator restores its anchor in an unchanged reference space |
| 2026-11-11 | IWER, `living_room` | Narrow layout seated at the table, evidence open | Caption, model, evidence and the button strip inside the narrow frame (key F); evidence readable over the model | Real field of view and legibility on a 3S |
| — | Quest 3S | Device checklist (§3), spikes S2–S5 | **Not run** | — |
